import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

export function compileEvent(extraSources = {}) {
  const input = {
    language: 'Solidity',
    sources: { 'EventRewards.sol': { content: fs.readFileSync('contracts/EventRewards.sol', 'utf8') }, ...extraSources },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), {
    import: (name) => {
      const target = path.resolve('node_modules', name);
      if (!target.startsWith(path.resolve('node_modules/@openzeppelin/contracts') + path.sep)) return { error: 'Unsupported import' };
      try { return { contents: fs.readFileSync(target, 'utf8') }; } catch { return { error: `Missing import: ${name}` }; }
    },
  }));
  const errors = (output.errors ?? []).filter((item) => item.severity === 'error');
  if (errors.length) throw new Error(errors.map((item) => item.formattedMessage).join('\n'));
  return output.contracts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const artifact = compileEvent()['EventRewards.sol'].EventRewards;
  fs.mkdirSync('build/contracts', { recursive: true });
  fs.writeFileSync('build/contracts/EventRewards.json', JSON.stringify({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}` }, null, 2));
  console.log('Compiled: build/contracts/EventRewards.json');
}
