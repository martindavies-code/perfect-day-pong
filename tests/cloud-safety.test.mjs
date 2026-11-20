import assert from 'node:assert/strict';
import {createCloudManager} from '../cloud.js';
import {createDefaultSave} from '../logic.js';
const data = new Map();
globalThis.window = {localStorage: {getItem:k=>data.get(k)??null, setItem:(k,v)=>data.set(k,v)}, google:{accounts:{oauth2:{initTokenClient:opts=>({requestAccessToken:()=>opts.callback({access_token:'test-only-token', expires_in:3600})})}}}};
let remote=createDefaultSave('remote'), writes=0, version='v1';
globalThis.fetch=async(url,opts={})=>{
  if(opts.method){writes++; return new Response(JSON.stringify({id:'test-file',md5Checksum:'v-next'}));}
  if(url.includes('alt=media')) return new Response(JSON.stringify(remote));
  return new Response(JSON.stringify({files:remote?[{id:'test-file',md5Checksum:version}]:[]}));
};
const cloud=createCloudManager();
assert.equal((await cloud.signInFromClick()).ok,true);
for(const local of [createDefaultSave('fresh'),{...createDefaultSave('used'),revision:8,totalEarned:400}]){
  data.clear(); writes=0;
  const result=await cloud.syncBeforeUpload(local);
  assert.equal(result.action,'conflict');assert.equal(result.conflictReason,'no_baseline');assert.equal(writes,0);
  await cloud.resolveUseCloud(result);
  const backup=JSON.parse(data.get('pdp_save_backups_v1'))[0];
  assert.equal(backup.doc.deviceId,local.deviceId);
}
data.clear();
let result=await cloud.syncBeforeUpload(createDefaultSave('used'));
await cloud.resolveUseLocal(result);
assert.equal(JSON.parse(data.get('pdp_save_backups_v1'))[0].doc.deviceId,'remote');
assert.equal(writes,1);
// Missing cloud creates an initial file, never a PATCH over an existing one.
remote=null; writes=0;data.clear();
assert.equal((await cloud.syncBeforeUpload(createDefaultSave())).action,'uploaded_initial');assert.equal(writes,1);
// Settings-style revision bump with unchanged remote syncs once.
remote=createDefaultSave('remote');data.set('pdp_cloud_sync_meta_v1',JSON.stringify({lastSyncedRevision:0,lastSyncedRemoteVersion:'v1'}));writes=0;
const changed=createDefaultSave('device');changed.revision++;changed.settings.quickDeuce=true;
await new Promise(resolve=>cloud.scheduleDebouncedSync(()=>changed,r=>{assert.equal(r.action,'uploaded');resolve();}));
assert.equal(writes,1);
// Remote-only update pulls, with a local backup.
data.set('pdp_cloud_sync_meta_v1',JSON.stringify({lastSyncedRevision:1,lastSyncedRemoteVersion:'old'}));writes=0;
assert.equal((await cloud.syncBeforeUpload(changed)).action,'pulled');assert.equal(writes,0);
assert.equal(JSON.parse(data.get('pdp_save_backups_v1'))[0].doc.deviceId,'device');
// Genuine diverged conflict reports conflictReason: 'diverged'.
data.set('pdp_cloud_sync_meta_v1',JSON.stringify({lastSyncedRevision:0,lastSyncedRemoteVersion:'old'}));
const diverged=await cloud.syncBeforeUpload(changed);
assert.equal(diverged.action,'conflict');assert.equal(diverged.conflictReason,'diverged');
console.log('Cloud safety: first sign-in (fresh and used), absent baseline, diverged conflict, missing cloud, debounced settings revision, and both conflict backups passed.');
