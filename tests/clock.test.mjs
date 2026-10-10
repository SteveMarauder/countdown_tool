import test from 'node:test';
import assert from 'node:assert/strict';
import { UtcClock, transition, remaining, digits } from '../public/core.mjs';
const state = { id:1,title:'Test',subtitle:'',duration_ms:10800000,remaining_ms:10800000,deadline_ms:null,status:'idle',revision:0,updated_at:0 };
test('斷線與伺服器重啟後由截止時間恢复，跨裝置一致', () => {
  const start = transition(state, 'start', {}, 1000000);
  const recovered = JSON.parse(JSON.stringify(start));
  assert.equal(remaining(recovered, 4600000), 7200000);
  assert.deepEqual(digits(remaining(recovered, 4600000)), ['02','00','00']);
  assert.equal(remaining(recovered, start.deadline_ms + 60000), 0);
});
test('暫停保留剩餘時間，繼續移動截止時間', () => {
  const running = transition(state,'start',{},1000);
  const paused = transition(running,'pause',{},2000);
  assert.equal(remaining(paused,900000),10800000-1000);
  const resumed = transition(paused,'resume',{},900000);
  assert.equal(resumed.deadline_ms,900000+paused.remaining_ms);
  assert.equal(transition(resumed,'reset',{},900001).remaining_ms,state.duration_ms);
});
test('指定截止時間與 168 小時邊界；拒絕非法轉換', () => {
  assert.equal(transition(state,'start',{deadline_ms:999999},1000).deadline_ms,999999);
  assert.throws(() => transition(state,'start',{deadline_ms:999},1000));
  assert.throws(() => transition(state,'configure',{title:'t',duration_ms:0},1000));
  assert.deepEqual(digits(168*3600000),['168','00','00']);
  assert.throws(() => transition(state,'resume',{},1000));
  assert.throws(() => transition(transition(state,'start',{},1000),'configure',{title:'t',duration_ms:1000},2000));
});
test('UTC 校時補償延遲，電腦系統時間改變不影響倒數', () => {
  let wall = 500000, mono = 200;
  const clock = new UtcClock(() => wall, () => mono);
  clock.calibrate(1000000,0,200);
  assert.equal(clock.now(),1000100);
  wall += 3600000; mono += 1000;
  assert.equal(clock.now(),1001100);
  assert.throws(() => clock.calibrate(NaN,0,10));
});
