"""End-to-end test of assembly-mate-connector / assembly-mate / assembly-group via the CLI."""
import json, subprocess, sys
PY="./venv/bin/python"; BASE=[PY,"-m","onshape_mcp.cli"]; res=[]
def run(a,label,expect=True):
    p=subprocess.run(BASE+a,capture_output=True,text=True)
    try: d=json.loads(p.stdout.strip())
    except Exception: d={"ok":False,"raw":p.stdout[:200],"stderr":p.stderr[:200]}
    ok=d.get("ok") is True
    res.append({"status":"PASS" if ok==expect else "FAIL","label":label,
                "detail":"" if ok else str(d.get("error",""))[:80]+" | "+str(d.get("detail",""))[:180]})
    return d.get("result",d)

doc=run(["create-document","--name","CLI-MATE-CLI","--public"],"create-document")
did=doc["id"]; wid=doc["defaultWorkspace"]["id"]
els=run(["get-elements","--doc",did,"--ws",wid],"get-elements")
def et(e): return (e.get("element_type") or e.get("type") or "").upper()
ps=next(e["id"] for e in els if et(e).startswith("PART"))
D=["--doc",did,"--ws",wid]; E=D+["--elem",ps]
sk=run(["sketch-rectangle",*E,"--plane","Top","--corner1","0,0","--corner2","2,1"],"sketch")
run(["extrude",*E,"--sketch",sk["featureId"],"--depth","0.5"],"extrude")
asm=run(["create-assembly",*D,"--name","Asm"],"create-assembly")
aeid=asm.get("id") or asm.get("elementId"); A=D+["--elem",aeid]
run(["insert-instance",*A,"--src-elem",ps,"--whole-studio"],"insert #1")
run(["insert-instance",*A,"--src-elem",ps,"--whole-studio"],"insert #2")
ad=run(["get-assembly",*A],"get-assembly")
ids=[i["id"] for i in ad["rootAssembly"]["instances"]]
mc1=run(["assembly-mate-connector",*A,"--occurrence",ids[0]],"mate-connector #1")
mc2=run(["assembly-mate-connector",*A,"--occurrence",ids[1]],"mate-connector #2")
fid1=mc1.get("featureId"); fid2=mc2.get("featureId")
run(["assembly-mate",*A,"--type","FASTENED","--connectors",f"{fid1},{fid2}"],"assembly-mate (fastened)")
run(["assembly-group",*A,"--occurrences",",".join(ids[:2])],"assembly-group")
run(["delete-document","--doc",did],"delete-document")
json.dump(res,open("/tmp/mate_summary.json","w"),ensure_ascii=True)
sys.exit(sum(1 for r in res if r["status"]=="FAIL"))
