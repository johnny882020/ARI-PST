import {OPERATION_ACCESS} from '../../packages/domain/src/capabilities.ts';
import {AUTHENTICATED_ROLES} from '../../packages/domain/src/roles.ts';
const o:any={};for(const [k,v] of Object.entries(OPERATION_ACCESS)){o[k]=v==='public'?'public':v==='auth'?[...AUTHENTICATED_ROLES]:[...(v as any)]}
console.log(JSON.stringify(o));
