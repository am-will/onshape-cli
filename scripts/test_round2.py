"""Round 2: rollback, metadata write, transform-instance, delete-instance, assembly export."""
import json, subprocess, sys
PY="./venv/bin/python"; BASE=[PY,"-m","onshape_mcp.cli"]; results=[]

def run(args, label, expect_ok=True):
    p=subprocess.run(BASE+args,capture_output=True,text=True)
    try: d=json.loads(p.stdout.strip())
    except Exception: d={"ok":False,"raw":p.stdout[:200],"stderr":p.stderr[:200]}
    ok=d.get("ok") is True
    results.append({"status":"PASS" if ok==expect_ok else "FAIL","label":label,
                    "detail":"" if ok else str(d.get("error",""))[:80]+" | "+str(d.get("detail",""))[:200]})
    return d.get("result",d)

doc=run(["create-document","--name","CLI-R2","--public"],"create-document")
did=doc["id"]; wid=doc["defaultWorkspace"]["id"]
els=run(["get-elements","--doc",did,"--ws",wid],"get-elements")
def et(e): return (e.get("element_type") or e.get("type") or "").upper()
ps=next(e["id"] for e in els if et(e).startswith("PART"))
D=["--doc",did,"--ws",wid]; E=D+["--elem",ps]
sk=run(["sketch-rectangle",*E,"--name","Base","--plane","Top","--corner1","0,0","--corner2","2,1"],"sketch")
run(["extrude",*E,"--name","Block","--sketch",sk["featureId"],"--depth","0.5"],"extrude")

# rollback
run(["rollback",*E,"--index","1"],"rollback to 1")
run(["rollback",*E,"--index","-1"],"rollback to end")

# metadata write (Description)
md=run(["get-metadata",*E],"get-metadata")
props=md.get("properties",[]) if isinstance(md,dict) else []
desc=next((p for p in props if p.get("name")=="Description" and p.get("editable")),None)
if desc:
    run(["set-metadata",*E,"--properties",json.dumps([{"propertyId":desc["propertyId"],"value":"set-by-cli"}])],"set-metadata")
else:
    results.append({"status":"SKIP","label":"set-metadata","detail":"no Description prop"})

# assembly: insert 2, group, transform, delete, export
asm=run(["create-assembly",*D,"--name","Asm"],"create-assembly")
aeid=asm.get("id") or asm.get("elementId"); A=D+["--elem",aeid]
run(["insert-instance",*A,"--src-elem",ps,"--whole-studio"],"insert #1")
run(["insert-instance",*A,"--src-elem",ps,"--whole-studio"],"insert #2")
ad=run(["get-assembly",*A],"get-assembly")
root=ad.get("rootAssembly",{})
ids=[i["id"] for i in root.get("instances",[])]
paths=[o["path"] for o in root.get("occurrences",[])]
run(["assembly-group",*A,"--occurrences",",".join(ids[:2])],"assembly-group")
if paths:
    T=[1,0,0,0.05, 0,1,0,0, 0,0,1,0, 0,0,0,1]
    run(["transform-instance",*A,"--paths",json.dumps([paths[0]]),"--transform",json.dumps(T)],"transform-instance")
if ids:
    run(["delete-instance",*A,"--node",ids[-1]],"delete-instance")
run(["export",*A,"--out","/tmp/asm_r2.step","--format","STEP","--kind","assemblies"],"export assembly STEP")

run(["delete-document","--doc",did],"delete-document")
json.dump(results,open("/tmp/r2_summary.json","w"),ensure_ascii=True)
sys.exit(sum(1 for r in results if r["status"]=="FAIL"))
