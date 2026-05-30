"""Live test: shaded-view (ps + assembly), thumbnail-info, get-thumbnail (with polling)."""
import json, subprocess, sys, os, time
PY = "./venv/bin/python"; BASE = [PY, "-m", "onshape_mcp.cli"]; res = []

def run(a, label, expect=True):
    p = subprocess.run(BASE + a, capture_output=True, text=True)
    try: d = json.loads(p.stdout.strip())
    except Exception: d = {"ok": False, "raw": p.stdout[:200], "stderr": p.stderr[:200]}
    ok = d.get("ok") is True
    res.append({"status": "PASS" if ok == expect else "FAIL", "label": label,
                "detail": "" if ok else str(d.get("error",""))[:70]+" | "+str(d.get("detail",""))[:140]})
    return d.get("result", d), ok

def is_png(path):
    try:
        with open(path,"rb") as f: return f.read(8).hex()=="89504e470d0a1a0a"
    except Exception: return False

doc,_ = run(["create-document","--name","CLI-IMG","--public"],"create-document")
did=doc["id"]; wid=doc["defaultWorkspace"]["id"]
els,_ = run(["get-elements","--doc",did,"--ws",wid],"get-elements")
def et(e): return (e.get("element_type") or e.get("type") or "").upper()
ps=next(e["id"] for e in els if et(e).startswith("PART"))
D=["--doc",did,"--ws",wid]; E=D+["--elem",ps]
sk,_=run(["sketch-rectangle",*E,"--plane","Top","--corner1","0,0","--corner2","2,1"],"sketch")
run(["extrude",*E,"--sketch",sk["featureId"],"--depth","0.5"],"extrude")

# shaded view part studio
sv="/tmp/_sv_ps.png"; [os.remove(sv) for _ in range(1) if os.path.exists(sv)]
run(["shaded-view",*E,"--out",sv],"shaded-view (part studio)")
res.append({"status":"PASS" if is_png(sv) else "FAIL","label":"ps shaded valid PNG",
            "detail":"" if is_png(sv) else "not PNG"})

# assembly + shaded view
asm,_=run(["create-assembly",*D,"--name","Asm"],"create-assembly")
aeid=asm.get("id") or asm.get("elementId"); A=D+["--elem",aeid]
run(["insert-instance",*A,"--src-elem",ps,"--whole-studio"],"insert-instance")
sva="/tmp/_sv_asm.png"; [os.remove(sva) for _ in range(1) if os.path.exists(sva)]
run(["shaded-view",*A,"--out",sva,"--kind","assemblies"],"shaded-view (assembly)")
res.append({"status":"PASS" if is_png(sva) else "FAIL","label":"asm shaded valid PNG",
            "detail":"" if is_png(sva) else "not PNG"})

# thumbnail-info always returns 200 (sizes may be empty initially)
run(["thumbnail-info",*E],"thumbnail-info")

# get-thumbnail: poll up to ~30s for async render
t="/tmp/_thumb.png"; [os.remove(t) for _ in range(1) if os.path.exists(t)]
got=False
for attempt in range(10):
    p=subprocess.run(BASE+["get-thumbnail",*E,"--out",t,"--size","300x300"],capture_output=True,text=True)
    try: d=json.loads(p.stdout.strip())
    except Exception: d={"ok":False}
    if d.get("ok") and is_png(t):
        got=True; break
    time.sleep(3)
res.append({"status":"PASS" if got else "FAIL","label":f"get-thumbnail PNG (after {attempt+1} tries)",
            "detail":"" if got else "thumbnail never rendered / not PNG within ~30s"})

run(["delete-document","--doc",did],"delete-document")
json.dump(res,open("/tmp/img_sum.json","w"),ensure_ascii=True)
for x in res: print("%-6s %-34s %s"%(x["status"],x["label"],x.get("detail","")[:110]))
sys.exit(sum(1 for x in res if x["status"]=="FAIL"))
