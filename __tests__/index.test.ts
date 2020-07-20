import * as plugin from '../';
import {createRepo} from '@gitsync/test';
import {ChangelogConfig} from "../";
import {Context, StringStringMap} from "@gitsync/sync";
import * as fs from 'fs-extra';
import * as path from 'path';
import {Git} from 'git-cli-wrapper';

async function createContext(): Promise<Context> {
  return {
    source: await createRepo(),
    target: await createRepo(),
    options: {
      target: '',
      sourceDir: '',
      removeTagPrefix: '@github-test/target-repo@',
      addTagPrefix: 'v'
    },
    getTargetHash: async (hash: string) => {
      const hashes: StringStringMap = {
        eab121cdc5ef25b633e50ef0f1919450bb003190: 'e38c589deb50a7f95d076afc4fca4c48f8f5747a',
        '8710ff29a7a8862d9e040a2f0047f04ed113931a': '72514a40be877b5cad007d145f523e2f700cf7f4'
      };
      return hashes[hash];
    }
  };
}

async function addFile(git: Git, file: string, content: string) {
  const filePath = path.join(git.dir, file);
  await fs.outputFile(filePath, content);
  await git.run(['add', file]);
}

async function readFile(git: Git, file: string) {
  const filePath = path.join(git.dir, file);
  return (await fs.readFile(filePath)).toString();
}

describe('changelog plugin', () => {
  test('prepare: default sourceUrl and targetUrl is false', async () => {
    const config: ChangelogConfig = {};
    const context = await createContext();

    await plugin.prepare(config, context);

    expect(config.sourceUrl).toBeFalsy();
    expect(config.targetUrl).toBeFalsy();
  });

  test('prepare: read url from git remote', async () => {
    const config: ChangelogConfig = {};
    const context = await createContext();

    await context.source.run(['remote', 'add', 'origin', 'https://github.com/test/repo.git']);
    await context.target.run(['remote', 'add', 'origin', 'git@github.com:test/repo2.git']);

    await plugin.prepare(config, context);

    expect(config.sourceUrl).toBe('https://github.com/test/repo');
    expect(config.targetUrl).toBe('https://github.com/test/repo2');
  });

  test('beforeCommit: replace all', async () => {
    const config: ChangelogConfig = {
      sourceUrl: 'https://github.com/twinh/github-actions-test',
      targetUrl: 'https://github.com/twinh/target-repo',
    };
    const context = await createContext();

    await addFile(context.target, 'CHANGELOG.md', `
## [1.0.1](https://github.com/twinh/github-actions-test/compare/@github-test/target-repo@1.0.0...@github-test/target-repo@1.0.1) (2020-07-17)


### Bug Fixes

* test close ([eab121c](https://github.com/twinh/github-actions-test/commit/eab121cdc5ef25b633e50ef0f1919450bb003190)), closes [#9](https://github.com/twinh/github-actions-test/issues/9)

# 1.0.0 (2020-07-17)


### Features

* feat ([8710ff2](https://github.com/twinh/github-actions-test/commit/8710ff29a7a8862d9e040a2f0047f04ed113931a))
`);

    await plugin.prepare(config, context);
    await plugin.beforeCommit(config, context);

    const content = await readFile(context.target, 'CHANGELOG.md');

    expect(content).toBe(`
## [1.0.1](https://github.com/twinh/target-repo/compare/v1.0.0...v1.0.1) (2020-07-17)


### Bug Fixes

* test close ([e38c589](https://github.com/twinh/target-repo/commit/e38c589deb50a7f95d076afc4fca4c48f8f5747a)), closes [#9](https://github.com/twinh/github-actions-test/issues/9)

# 1.0.0 (2020-07-17)


### Features

* feat ([72514a4](https://github.com/twinh/target-repo/commit/72514a40be877b5cad007d145f523e2f700cf7f4))
`);
  });

  test('beforeCommit: replace tag', async () => {
    const config: ChangelogConfig = {};
    const context = await createContext();

    await addFile(context.target, 'CHANGELOG.md', `@github-test/target-repo@1.0.0 @github-test/target-repo@1.0.1-beta.1`);

    await plugin.prepare(config, context);
    await plugin.beforeCommit(config, context);

    const content = await readFile(context.target, 'CHANGELOG.md');

    expect(content).toBe(`v1.0.0 v1.0.1-beta.1`);
  });

  test('beforeCommit: replace URL', async () => {
    const config: ChangelogConfig = {
      sourceUrl: 'https://github.com/twinh/github-actions-test',
      targetUrl: 'https://github.com/twinh/target-repo',
    };
    const context = await createContext();

    await addFile(context.target, 'CHANGELOG.md', `# https://github.com/twinh/github-actions-test/something`);

    await plugin.prepare(config, context);
    await plugin.beforeCommit(config, context);

    const content = await readFile(context.target, 'CHANGELOG.md');

    expect(content).toBe(`# https://github.com/twinh/target-repo/something`);
  });

  test('beforeCommit: replace URL ignore issue URL', async () => {
    const config: ChangelogConfig = {
      sourceUrl: 'https://github.com/twinh/github-actions-test',
      targetUrl: 'https://github.com/twinh/target-repo',
    };
    const context = await createContext();

    await addFile(context.target, 'CHANGELOG.md', `# https://github.com/twinh/github-actions-test/issues`);

    await plugin.prepare(config, context);
    await plugin.beforeCommit(config, context);

    const content = await readFile(context.target, 'CHANGELOG.md');

    expect(content).toBe(`# https://github.com/twinh/github-actions-test/issues`);
  });

  test('beforeCommit: replace hashed', async () => {
    const config: ChangelogConfig = {};
    const context = await createContext();

    await addFile(context.target, 'CHANGELOG.md', `
[eab121c](eab121cdc5ef25b633e50ef0f1919450bb003190)
[aab121c](aab121cdc5ef25b633e50ef0f1919450bb003190)
`);

    await plugin.prepare(config, context);
    await plugin.beforeCommit(config, context);

    const content = await readFile(context.target, 'CHANGELOG.md');

    expect(content).toBe(`
[e38c589](e38c589deb50a7f95d076afc4fca4c48f8f5747a)
[aab121c](aab121cdc5ef25b633e50ef0f1919450bb003190)
`);
  });

  test('beforeCommit: custom files', async () => {
    const config: ChangelogConfig = {
      files: ['README.md'],
    };
    const context = await createContext();

    await addFile(context.target, 'CHANGELOG.md', `@github-test/target-repo@1.0.0`);
    await addFile(context.target, 'README.md', `@github-test/target-repo@1.0.0`);

    await plugin.prepare(config, context);
    await plugin.beforeCommit(config, context);

    const content = await readFile(context.target, 'CHANGELOG.md');
    expect(content).toBe(`@github-test/target-repo@1.0.0`);

    const content2 = await readFile(context.target, 'README.md');
    expect(content2).toBe(`v1.0.0`);
  });
});
