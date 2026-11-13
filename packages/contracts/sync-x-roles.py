import re,subprocess,json,os
open('apps/api/caps.tmp.mts','w').write("""import {OPERATION_ACCESS} from '../../packages/domain/src/capabilities.ts';
import {AUTHENTICATED_ROLES} from '../../packages/domain/src/roles.ts';
const o:any={};for(const [k,v] of Object.entries(OPERATION_ACCESS)){o[k]=v==='public'?'public':v==='auth'?[...AUTHENTICATED_ROLES]:[...(v as any)]}
console.log(JSON.stringify(o));""")
out=subprocess.run(['npx','tsx','caps.tmp.mts'],capture_output=True,text=True,cwd='apps/api').stdout
os.remove('apps/api/caps.tmp.mts')
m=json.loads(out); seen=set()
res=[]
for l in open('packages/contracts/openapi.yaml').read().split('\n'):
    if re.match(r'^\s+x-roles: ',l): continue
    res.append(l)
    mm=re.match(r'^(\s+)operationId: (\w+)\s*$',l)
    if mm:
        ind,op=mm.groups()
        if op not in m: print('NO CAP',op); continue
        seen.add(op); v=m[op]; res.append(f"{ind}x-roles: "+('public' if v=='public' else '['+', '.join(v)+']'))
print('caps without op:',set(m)-seen)
open('packages/contracts/openapi.yaml','w').write('\n'.join(res))
