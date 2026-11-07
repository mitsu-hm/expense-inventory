import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('manual expenses persist, remain user-scoped, validate and support corrections', async () => {
  let factory: any;
  try { factory = (await import('../server/app.js')).buildApp; } catch { /* missing implementation is the initial RED assertion */ }
  assert.equal(typeof factory, 'function', 'A working application factory is required');
  const directory = mkdtempSync(join(tmpdir(), 'ledgersprout-test-'));
  const dbPath = join(directory, 'test.sqlite');
  let app = await factory({ dbPath });
  const h: Record<string,string> = { 'x-ledger-request': '1' };
  try {
    const signup = await app.inject({method:'POST',url:'/api/register',headers:h,payload:{name:'Test Owner',email:'owner@example.com',password:'CorrectHorse42!'}});
    assert.equal(signup.statusCode,201, signup.body);
    h.cookie = (Array.isArray(signup.headers['set-cookie']) ? signup.headers['set-cookie'][0] : signup.headers['set-cookie']).split(';')[0];
    const input = {paymentDate:'2026-11-01',description:'Packing materials',amount:'100.25',method:'UPI',additionalInformation:'Operations',transactionRef:'PAY-001',requestKey:'request-001'};
    const saved = await app.inject({method:'POST',url:'/api/expenses',headers:h,payload:input});
    assert.equal(saved.statusCode,201,saved.body);
    const record = saved.json();
    assert.equal(record.amount,'100.25');
    await app.close(); app=await factory({dbPath});
    const list=await app.inject({method:'GET',url:'/api/expenses',headers:h});
    assert.equal(list.json().total,'100.25'); assert.equal(list.json().records.length,1);
    const update=await app.inject({method:'PUT',url:'/api/expenses/'+record.id,headers:h,payload:{...input,description:'Packing materials corrected',amount:'120.30',version:record.version}});
    assert.equal(update.statusCode,200,update.body); assert.equal(update.json().amount,'120.30');
    assert.equal((await app.inject({method:'GET',url:'/api/expenses?q=corrected&method=UPI&from=2026-11-01&to=2026-11-01',headers:h})).json().total,'120.30');
    assert.equal((await app.inject({method:'GET',url:'/api/expenses?method=Cash',headers:h})).json().total,'0.00');
    for (const invalid of [{amount:'-1'},{amount:'1.001'},{method:''},{method:'Bank'},{paymentDate:'2026-02-30'}]) {
      const response=await app.inject({method:'POST',url:'/api/expenses',headers:h,payload:{...input,requestKey:crypto.randomUUID(),transactionRef:'',...invalid}});
      assert.equal(response.statusCode,400,response.body);
    }
    const stale=await app.inject({method:'PUT',url:'/api/expenses/'+record.id,headers:h,payload:{...input,version:record.version}});
    assert.equal(stale.statusCode,409);
    assert.equal((await app.inject({method:'GET',url:'/api/expenses'})).statusCode,401);
    assert.equal((await app.inject({method:'GET',url:'/api/expenses?space=demo',headers:h})).json().records.every((r:any)=>r.id!==record.id),true);
    const history=await app.inject({method:'GET',url:'/api/expenses/'+record.id+'/history',headers:h});
    assert.equal(history.json().records.length,2);
    assert.equal((await app.inject({method:'POST',url:'/api/login',headers:{origin:'https://evil.example','x-ledger-request':'1'},payload:{email:'owner@example.com',password:'CorrectHorse42!'}})).statusCode,403);
  } finally { await app.close(); rmSync(directory,{recursive:true,force:true}); }
});
