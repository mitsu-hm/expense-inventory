import { buildApp, type AppOptions } from '../server/app.js';
export async function fixture(options:AppOptions={dbPath:':memory:'}) {
 const app=await buildApp(options);
 const signup=await app.inject({method:'POST',url:'/api/register',headers:{'x-ledger-request':'1'},payload:{name:'Fixture Owner',email:'fixture@example.com',password:'CorrectHorse42!'}});
 if(signup.statusCode!==201)throw new Error(signup.body);
 const cookie=signup.headers['set-cookie'];
 const headers={'x-ledger-request':'1',cookie:(Array.isArray(cookie)?cookie[0]:cookie!).split(';')[0]};
 const request=async(method:string,url:string,payload?:unknown)=>app.inject({method:method as any,url,headers,payload:payload as any});
 return {app,headers,request,user:signup.json().user};
}
