import assert from 'node:assert/strict';
import { test } from 'node:test';
import ganache from 'ganache';
import { createPublicClient, createWalletClient, custom } from 'viem';
import { sepolia } from 'viem/chains';
import { compileEvent } from '../scripts/compile-event.mjs';

const mock = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract MockJPYC is ERC20 {
 bool public fail;
 constructor() ERC20("Test JPYC", "JPYC") {}
 function mint(address to, uint256 amount) external { _mint(to, amount); }
 function setFail(bool value) external { fail = value; }
 function transfer(address to, uint256 amount) public override returns (bool) {
  if (fail) return false;
  return super.transfer(to, amount);
 }
}
interface IEvent { function register() external; }
contract ContractParticipant {
 function register(address target) external { IEvent(target).register(); }
}`;

test('event distributes JPYC and an ERC721 atomically, once per wallet', async (t) => {
  const compiled = compileEvent({ 'MockJPYC.sol': { content: mock } });
  const provider = ganache.provider({ chain: { chainId: 11155111, hardfork: 'shanghai' }, logging: { quiet: true } });
  try {
    const transport = custom(provider);
    const publicClient = createPublicClient({ chain: sepolia, transport });
    const wallet = createWalletClient({ chain: sepolia, transport });
    const [organizer, alice, bob] = await wallet.getAddresses();
    const tokenArtifact = compiled['MockJPYC.sol'].MockJPYC;
    const eventArtifact = compiled['EventRewards.sol'].EventRewards;
    async function deploy(artifact, args = []) {
      const hash = await wallet.deployContract({ account: organizer, abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, args, gas: 5_000_000n });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      assert.equal(receipt.status, 'success');
      return receipt.contractAddress;
    }
    const token = await deploy(tokenArtifact);
    const event = await deploy(eventArtifact, [token]);
    const read = (functionName, args = []) => publicClient.readContract({ address: event, abi: eventArtifact.abi, functionName, args });
    const balance = (owner) => publicClient.readContract({ address: token, abi: tokenArtifact.abi, functionName: 'balanceOf', args: [owner] });
    async function write(address, artifact, functionName, args = [], account = organizer) {
      const hash = await wallet.writeContract({ account, address, abi: artifact.abi, functionName, args, gas: 3_000_000n });
      return publicClient.waitForTransactionReceipt({ hash });
    }
    await t.test('insufficient JPYC rolls back registration and NFT', async () => {
      assert.equal((await write(event, eventArtifact, 'register', [], alice)).status, 'reverted');
      assert.equal(await read('certificateOf', [alice]), 0n);
      assert.equal(await read('totalRegistered'), 0n);
      assert.equal(await balance(alice), 0n);
    });
    await write(token, tokenArtifact, 'mint', [event, 2n * 10n ** 18n]);
    await t.test('registration sends exactly one JPYC and mints a real certificate', async () => {
      assert.equal((await write(event, eventArtifact, 'register', [], alice)).status, 'success');
      assert.equal(await balance(alice), 10n ** 18n);
      assert.equal(await read('certificateOf', [alice]), 1n);
      assert.equal((await read('ownerOf', [1n])).toLowerCase(), alice.toLowerCase());
      assert.ok(await read('registeredAt', [alice]) > 0n);
      const uri = await read('tokenURI', [1n]);
      const metadata = JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString());
      assert.match(metadata.name, /Participation Certificate/);
      assert.match(metadata.image, /^data:image\/svg\+xml;base64,/);
    });
    await t.test('duplicate registration does not pay or mint again', async () => {
      assert.equal((await write(event, eventArtifact, 'register', [], alice)).status, 'reverted');
      assert.equal(await balance(alice), 10n ** 18n);
      assert.equal(await read('totalRegistered'), 1n);
    });
    await t.test('a token returning false rolls back every change', async () => {
      await write(token, tokenArtifact, 'setFail', [true]);
      assert.equal((await write(event, eventArtifact, 'register', [], bob)).status, 'reverted');
      assert.equal(await read('certificateOf', [bob]), 0n);
      assert.equal(await read('registeredAt', [bob]), 0n);
      assert.equal(await read('totalRegistered'), 1n);
      assert.equal(await balance(bob), 0n);
      await write(token, tokenArtifact, 'setFail', [false]);
    });
    await t.test('another participant can independently register', async () => {
      assert.equal((await write(event, eventArtifact, 'register', [], bob)).status, 'success');
      assert.equal((await read('ownerOf', [2n])).toLowerCase(), bob.toLowerCase());
      assert.equal(await balance(bob), 10n ** 18n);
      assert.equal(await read('totalRegistered'), 2n);
    });
    await t.test('a contract wallet without an NFT receiver hook can receive both rewards', async () => {
      const participant = await deploy(compiled['MockJPYC.sol'].ContractParticipant);
      await write(token, tokenArtifact, 'mint', [event, 10n ** 18n]);
      assert.equal((await write(participant, compiled['MockJPYC.sol'].ContractParticipant, 'register', [event])).status, 'success');
      assert.equal(await balance(participant), 10n ** 18n);
      assert.equal((await read('ownerOf', [3n])).toLowerCase(), participant.toLowerCase());
    });
  } finally { await provider.disconnect(); }
});
