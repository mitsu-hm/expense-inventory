import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
export type Row = Record<string, any>;
export class Store {
  db: DatabaseSync;
  private depth=0;
  constructor(path: string) {
    if(path!==':memory:') mkdirSync(dirname(path),{recursive:true});
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
    const folder=resolve('server/migrations');
    for(const name of readdirSync(folder).filter(n=>n.endsWith('.sql')).sort()) {
      if(!this.one('SELECT name FROM schema_migrations WHERE name=?',name)) this.transaction(()=>{
        this.db.exec(readFileSync(resolve(folder,name),'utf8'));
        this.run('INSERT INTO schema_migrations VALUES (?,?)',name,Date.now());
      });
    }
  }
  one(sql:string,...params:any[]):Row|undefined {return this.db.prepare(sql).get(...params) as Row|undefined;}
  all(sql:string,...params:any[]):Row[] {return this.db.prepare(sql).all(...params) as Row[];}
  run(sql:string,...params:any[]) {return this.db.prepare(sql).run(...params);}
  transaction<T>(fn:()=>T):T {
    const nested=this.depth>0,point=`ledger_sp_${this.depth}`;
    this.db.exec(nested?`SAVEPOINT ${point}`:'BEGIN IMMEDIATE');this.depth++;
    try { const value=fn(); this.db.exec(nested?`RELEASE SAVEPOINT ${point}`:'COMMIT');return value; }
    catch(error){this.db.exec(nested?`ROLLBACK TO SAVEPOINT ${point}`:'ROLLBACK');if(nested)this.db.exec(`RELEASE SAVEPOINT ${point}`);throw error;}
    finally{this.depth--;}
  }
  audit(userId:string,space:string,id:string,action:string,before:any,after:any,now:number) {
    this.run('INSERT INTO audit_events VALUES (?,?,?,?,?,?,?,?)',randomUUID(),userId,space,id,action,before?JSON.stringify(before):null,after?JSON.stringify(after):null,now);
  }
  close(){this.db.close();}
}
