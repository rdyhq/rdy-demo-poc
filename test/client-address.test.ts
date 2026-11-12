import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clientAddress, proxyChainNote, trustedProxyHops } from '../src/client-address.ts';

test('the socket address is used while no proxy is trusted',()=>{
  assert.equal(clientAddress('10.0.0.9',undefined,0),'10.0.0.9');
  assert.equal(clientAddress('10.0.0.9','203.0.113.7',0),'10.0.0.9');
  assert.equal(clientAddress(undefined,undefined,0),'unknown');
});

test('one trusted proxy yields the address that proxy appended',()=>{
  assert.equal(clientAddress('10.0.0.9','203.0.113.7',1),'203.0.113.7');
  // The client supplied the first entry. Only the appended entry is trusted.
  assert.equal(clientAddress('10.0.0.9','198.51.100.1, 203.0.113.7',1),'203.0.113.7');
});

test('two trusted proxies yield the second address from the right',()=>{
  assert.equal(clientAddress('10.0.0.9','198.51.100.1, 203.0.113.7, 172.16.0.4',2),'203.0.113.7');
});

test('a forwarded chain shorter than the trusted proxies falls back to the socket address',()=>{
  assert.equal(clientAddress('10.0.0.9','203.0.113.7',2),'10.0.0.9');
  assert.equal(clientAddress('10.0.0.9','',1),'10.0.0.9');
});

test('the trusted proxy count comes from LOBBY_TRUST_PROXY and rejects other values',()=>{
  assert.equal(trustedProxyHops(undefined),0);
  assert.equal(trustedProxyHops('1'),1);
  assert.equal(trustedProxyHops('2'),2);
  for(const value of ['yes','-1','1.5','6','']) {
    assert.throws(()=>trustedProxyHops(value),/LOBBY_TRUST_PROXY/);
  }
});

test('a liveness request through proxies gives one log line with the length of the chain',()=>{
  const seen=new Set<string>();
  assert.equal(proxyChainNote(seen,'/healthz','linb.io','203.0.113.7, 198.51.100.2'),
    'LINB proxy chain: 2 forwarded entries on a request for linb.io.');
  // The line names no address, and each host is reported once.
  assert.equal(proxyChainNote(seen,'/healthz','linb.io','203.0.113.9'),null);
  assert.equal(proxyChainNote(seen,'/healthz','LOBBY-staging.onrender.com',' 203.0.113.7 '),
    'LINB proxy chain: 1 forwarded entries on a request for lobby-staging.onrender.com.');
  // Other paths, a direct request and a strange host give no line.
  assert.equal(proxyChainNote(seen,'/','l1nb.io','203.0.113.7'),null);
  assert.equal(proxyChainNote(seen,'/healthz','l1nb.io',undefined),null);
  assert.equal(proxyChainNote(seen,'/healthz','bad host\nline','203.0.113.7'),null);
  assert.equal(proxyChainNote(seen,'/healthz',undefined,'203.0.113.7'),null);
  // Five hosts at most, so a visitor cannot fill the log.
  for(const host of ['a.example','b.example','c.example']) assert.ok(proxyChainNote(seen,'/healthz',host,'203.0.113.7'));
  assert.equal(seen.size,5);
  assert.equal(proxyChainNote(seen,'/healthz','d.example','203.0.113.7'),null);
});
