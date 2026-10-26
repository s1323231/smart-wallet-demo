import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';

const source = ts.transpileModule(fs.readFileSync('src/components/EventRecords.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const walletA = `0x${'a'.repeat(40)}`;
const walletB = `0x${'b'.repeat(40)}`;
const key = (address) => `inapp-wallet-events:${address.toLowerCase()}`;
const existing = { id: 'existing-id', name: '以前のライブ', date: '2026-09-01' };

function storageFixture(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data, writes: [], failRead: false, failWrite: false,
    getItem(name) {
      if (this.failRead) throw Error('storage access denied');
      return data.get(name) ?? null;
    },
    setItem(name, value) {
      if (this.failWrite) throw Error('storage quota exceeded');
      this.writes.push({ key: name, value });
      data.set(name, String(value));
    },
  };
}

function text(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  return node?.props ? text(node.props.children) : '';
}

// コンポーネントの実コードを読み、既存テストと同じHooks方式で操作する。
// 各インスタンスは独立したstateを持ち、同じstorageを渡すと別タブ相当になる。
function component(storage, address = walletA) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  const useState = (initial) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
  };
  const useEffect = (effect, dependencies) => {
    const index = cursor++;
    if (!(index in slots) || dependencies.some((value, i) => value !== slots[index][i])) {
      slots[index] = dependencies;
      effects.push(effect);
    }
  };
  const loaded = { exports: {} };
  new Function('require', 'exports', source)((name) => {
    if (name === 'react') return { useState, useEffect };
    if (name === 'react/jsx-runtime') return jsxRuntime;
    throw Error(`Unexpected import (wallet/network modules forbidden): ${name}`);
  }, loaded.exports);
  const render = () => {
    globalThis.localStorage = storage;
    cursor = 0;
    const root = loaded.exports.EventRecords({ address });
    const elements = [];
    const visit = (node) => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node || typeof node !== 'object') return;
      elements.push(node);
      visit(node.props?.children);
    };
    visit(root);
    return {
      input: (id) => elements.find((e) => e.type === 'input' && e.props.id === id),
      button: elements.find((e) => e.type === 'button'),
      form: elements.find((e) => e.type === 'form'),
      records: elements.filter((e) => e.type === 'li').map((e) => ({ id: e.key, text: text(e) })),
      error: elements.find((e) => e.props?.role === 'alert')?.props.children,
      text: text(root),
    };
  };
  const mount = () => {
    render();
    const pending = effects; effects = [];
    pending.forEach((effect) => effect());
    return render();
  };
  const fill = (name, date) => {
    render().input('event-name').props.onChange({ target: { value: name } });
    render().input('event-date').props.onChange({ target: { value: date } });
  };
  const submit = () => {
    let prevented = false;
    render().form.props.onSubmit({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    return render();
  };
  return { render, mount, fill, submit };
}

test('registers event name/date, saves JSON and clears inputs only after success', () => {
  const storage = storageFixture();
  const page = component(storage);
  page.mount(); page.fill('卒業ライブ', '2026-10-27');
  assert.equal(page.render().button.props.disabled, false);
  const view = page.submit();
  assert.equal(view.records.length, 1);
  assert.match(view.records[0].text, /卒業ライブ2026\/10\/27/);
  assert.match(view.text, /登録した参加記録（1件）/);
  const saved = JSON.parse(storage.data.get(key(walletA)));
  assert.equal(saved[0].name, '卒業ライブ');
  assert.equal(saved[0].date, '2026-10-27');
  assert.equal(saved[0].id, view.records[0].id);
  assert.equal(view.input('event-name').props.value, '');
  assert.equal(view.input('event-date').props.value, '');
  assert.equal(view.error, undefined);
});

test('trims names, assigns unique UUIDs and prepends records without removing existing ones', () => {
  const storage = storageFixture();
  const page = component(storage); page.mount();
  page.fill('  ライブA　', '2026-10-26'); page.submit();
  page.fill('　ライブB  ', '2026-10-27'); page.submit();
  const saved = JSON.parse(storage.data.get(key(walletA)));
  assert.deepEqual(saved.map((r) => r.name), ['ライブB', 'ライブA']);
  for (const r of saved) assert.match(r.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(saved[0].id, saved[1].id);
});

test('recreating component restores saved IDs/names/dates without rewriting storage', () => {
  const storage = storageFixture();
  const first = component(storage); first.mount();
  first.fill('復元するイベント', '2026-10-27'); first.submit();
  const raw = storage.data.get(key(walletA));
  const writes = storage.writes.length;
  const reloaded = component(storage).mount();
  assert.deepEqual(reloaded.records, first.render().records);
  assert.match(reloaded.text, /登録した参加記録（1件）/);
  assert.equal(storage.data.get(key(walletA)), raw);
  assert.equal(storage.writes.length, writes);
});

test('wallets keep separate records when registering and remounting', () => {
  const storage = storageFixture();
  const a = component(storage, walletA); a.mount(); a.fill('Aの記録', '2026-10-26'); a.submit();
  const b = component(storage, walletB);
  assert.deepEqual(b.mount().records, []);
  b.fill('Bの記録', '2026-10-27'); b.submit();
  assert.deepEqual(JSON.parse(storage.data.get(key(walletA))).map((r) => r.name), ['Aの記録']);
  assert.deepEqual(JSON.parse(storage.data.get(key(walletB))).map((r) => r.name), ['Bの記録']);
  assert.match(component(storage, walletA).mount().records[0].text, /Aの記録/);
  assert.match(component(storage, walletB).mount().records[0].text, /Bの記録/);
});

test('address case differences use the same wallet storage', () => {
  const storage = storageFixture({ [key(walletA)]: JSON.stringify([existing]) });
  assert.equal(component(storage, walletA.toUpperCase()).mount().records[0].id, existing.id);
  assert.equal(storage.writes.length, 0);
});

test('failed save preserves stored data, existing list and input, and retry can succeed', () => {
  const raw = JSON.stringify([existing]);
  const storage = storageFixture({ [key(walletA)]: raw });
  const page = component(storage); page.mount(); page.fill('  追加したい記録  ', '2026-10-27');
  storage.failWrite = true;
  const failed = page.submit();
  assert.match(failed.error, /参加記録を保存できませんでした/);
  assert.equal(failed.records.length, 1);
  assert.equal(failed.records[0].id, existing.id);
  assert.equal(failed.input('event-name').props.value, '  追加したい記録  ');
  assert.equal(failed.input('event-date').props.value, '2026-10-27');
  assert.equal(storage.data.get(key(walletA)), raw);
  assert.equal(storage.writes.length, 0);
  storage.failWrite = false;
  const retried = page.submit();
  assert.equal(retried.records.length, 2);
  assert.equal(retried.error, undefined);
  assert.equal(retried.input('event-name').props.value, '');
  assert.equal(retried.input('event-date').props.value, '');
  assert.equal(JSON.parse(storage.data.get(key(walletA)))[1].id, existing.id);
});

test('missing storage produces empty list without creating or overwriting data', () => {
  const storage = storageFixture();
  const view = component(storage).mount();
  assert.deepEqual(view.records, []);
  assert.match(view.text, /まだ参加記録はありません/);
  assert.equal(view.error, undefined);
  assert.equal(view.button.props.disabled, true);
  assert.equal(storage.data.has(key(walletA)), false);
  assert.equal(storage.writes.length, 0);
});

for (const raw of ['{broken json', 'null', '{}', '[null]', '[{"id":"x","name":"a"}]', '[{"id":1,"name":"a","date":"2026-10-27"}]']) {
  test(`invalid saved data is preserved and registration blocked: ${raw}`, () => {
    const storage = storageFixture({ [key(walletA)]: raw });
    const page = component(storage);
    const view = page.mount();
    assert.match(view.error, /参加記録を読み込めませんでした/);
    assert.deepEqual(view.records, []);
    page.fill('上書きさせない', '2026-10-27');
    assert.equal(page.render().button.props.disabled, true);
    page.submit();
    assert.equal(storage.data.get(key(walletA)), raw);
    assert.equal(storage.writes.length, 0);
  });
}

test('storage read failure shows error and prevents registration', () => {
  const raw = JSON.stringify([existing]);
  const storage = storageFixture({ [key(walletA)]: raw }); storage.failRead = true;
  const page = component(storage); page.mount(); page.fill('新規', '2026-10-27');
  const view = page.submit();
  assert.match(view.error, /参加記録を読み込めませんでした/);
  assert.equal(view.button.props.disabled, true);
  assert.equal(storage.data.get(key(walletA)), raw);
  assert.equal(storage.writes.length, 0);
});

for (const [name, date] of [['', '2026-10-27'], ['　  ', '2026-10-27'], ['ライブ', '']]) {
  test(`incomplete input does not register: ${JSON.stringify([name, date])}`, () => {
    const storage = storageFixture();
    const page = component(storage); page.mount(); page.fill(name, date);
    assert.equal(page.render().button.props.disabled, true);
    assert.deepEqual(page.submit().records, []);
    assert.equal(storage.writes.length, 0);
  });
}

test('registration before restoration finishes does not overwrite existing records', () => {
  const raw = JSON.stringify([existing]);
  const storage = storageFixture({ [key(walletA)]: raw });
  const page = component(storage); page.fill('早すぎる登録', '2026-10-27');
  assert.equal(page.render().button.props.disabled, true);
  page.submit();
  assert.equal(storage.data.get(key(walletA)), raw);
  assert.equal(storage.writes.length, 0);
});

test('KNOWN ISSUE: stale tabs overwrite the first registration (reproduction, not a fix)', () => {
  const storage = storageFixture({ [key(walletA)]: JSON.stringify([existing]) });
  const tabA = component(storage); const tabB = component(storage);
  tabA.mount(); tabB.mount();
  tabA.fill('タブAで登録', '2026-10-26'); tabB.fill('タブBで登録', '2026-10-27');
  tabA.submit();
  const savedByA = JSON.parse(storage.data.get(key(walletA)));
  assert.deepEqual(savedByA.map((r) => r.name), ['タブAで登録', existing.name]);
  tabB.submit();
  const finalSaved = JSON.parse(storage.data.get(key(walletA)));
  // 現状の不具合を明示的に記録する。競合を修正する際は「両方が残る」回帰テストに変更する。
  assert.deepEqual(finalSaved.map((r) => r.name), ['タブBで登録', existing.name]);
  assert.equal(finalSaved.some((r) => r.id === savedByA[0].id), false);
  assert.match(tabA.render().records[0].text, /タブAで登録/); // タブAの見た目にも消失が反映されない
  const reloaded = component(storage).mount();
  assert.equal(reloaded.records.length, 2);
  assert.match(reloaded.records[0].text, /タブBで登録/);
});
