import fs from 'node:fs';
import { encodeAbiParameters, encodeDeployData } from 'viem';
import { compileEvent } from './compile-event.mjs';

// Browser consumes only public bytecode; solc and filesystem code stay in this script.
const token = '0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29';
const artifact = compileEvent()['EventRewards.sol'].EventRewards;
const bytecode = `0x${artifact.evm.bytecode.object}`;
const initCode = encodeDeployData({ abi: artifact.abi, bytecode, args: [token] });
let runtime = artifact.evm.deployedBytecode.object;
const values = Object.values(artifact.evm.deployedBytecode.immutableReferences);
if (values.length !== 1) throw Error('Expected only the JPYC immutable. Review generator after contract changes.');
const encodedToken = encodeAbiParameters([{ type: 'address' }], [token]).slice(2);
for (const { start, length } of values[0]) {
  if (length !== 32) throw Error('Unexpected immutable size');
  runtime = runtime.slice(0, start * 2) + encodedToken + runtime.slice((start + length) * 2);
}
const data = { initCode, runtimeCode: `0x${runtime}` };
const target = 'src/lib/generated/eventDeployment.json';
const serialized = `${JSON.stringify(data, null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8') !== serialized) throw Error('Deployment artifact is stale. Run npm run event:artifact.');
  console.log('Deployment artifact matches Solidity source.');
} else {
  fs.mkdirSync('src/lib/generated', { recursive: true });
  fs.writeFileSync(target, serialized);
  console.log(`Generated ${target}`);
}
