import * as path from 'path';
import * as _ from 'lodash';
import * as fs from 'fs-extra';
import {Context} from '@gitsync/sync';
import {PluginConfig} from '@gitsync/sync/lib/plugin';
import log from '@gitsync/log';
import * as escapeStringRegexp from 'escape-string-regexp';
import * as hostedGitInfo from 'hosted-git-info';
import {Git} from "git-cli-wrapper";

const GIT_HASH_REGEX = /\b([a-f0-9]{40})\b/g;

export interface ChangelogConfig extends PluginConfig {
  sourceUrl?: string | false;
  targetUrl?: string | false;
  files?: string[];

  // @internal
  sourceUrlRegex?: RegExp,
  sourceTagRegex?: RegExp,
  targetTagReplacer?: string,
};

async function replaceAsync(str: string, regex: RegExp, asyncFn: Function) {
  const promises: Promise<string>[] = [];
  str.replace(regex, (match, ...args) => {
    const promise = asyncFn(match, ...args);
    promises.push(promise);
    return match;
  });
  const data: string[] = await Promise.all(promises);
  return str.replace(regex, () => data.shift());
}

async function getGitUrl(git: Git) {
  let originUrl;
  try {
    originUrl = await git.run(['config', '--get', 'remote.origin.url']);
    if (!originUrl) {
      return false;
    }
  } catch (e) {
    log.debug('Ignore get git url error', e.message);
    return false;
  }

  const info = hostedGitInfo.fromUrl(originUrl, {noGitPlus: true});
  const url = info.https();
  // Remove ending ".git"
  return url.substr(0, url.length - 4);
}

async function prepare(config: ChangelogConfig, context: Context) {
  const {options} = context;

  if (!config.sourceUrl) {
    config.sourceUrl = await getGitUrl(context.source);
  }

  if (config.sourceUrl) {
    // Ignore issue URL
    config.sourceUrlRegex = new RegExp(escapeStringRegexp(config.sourceUrl) + '(?!/issue)', 'g');
  }

  if (!config.targetUrl) {
    config.targetUrl = await getGitUrl(context.target);
  }

  if (options.removeTagPrefix) {
    config.sourceTagRegex = new RegExp('(' + escapeStringRegexp(options.removeTagPrefix) + ')([0-9]+\.[0-9]+\.[0-9]+\)', 'g');
    config.targetTagReplacer = options.addTagPrefix + '$2';
  }
}

async function beforeCommit(config: ChangelogConfig, context: Context) {
  const {files = ['CHANGELOG.md']} = config;

  const result = await context.target.run(['diff', '--staged', '--diff-filter=ACMR', '--name-only']);
  log.debug(`Found staged files: ${result}`);

  const changedFiles = _.intersection(files, result.trim().split('\n'));
  log.debug(`Found matched files: ${changedFiles}`);

  for (const file of changedFiles) {
    const fullPath = path.join(context.target.dir, file);

    let content = (await fs.readFile(fullPath)).toString();

    // 1. replace tags
    if (config.sourceTagRegex) {
      content = content.replace(config.sourceTagRegex, config.targetTagReplacer);
    }

    // 2. replace URL
    if (config.sourceUrl && config.targetUrl) {
      content = content.replace(config.sourceUrlRegex, config.targetUrl);
    }

    // 3. replace hashes
    const shortHashes: { [key: string]: string } = {};
    content = await replaceAsync(content, GIT_HASH_REGEX, async (hash: string) => {
      try {
        const result = await context.getTargetHash(hash);
        shortHashes[hash.substr(0, 7)] = result.substr(0, 7);
        return result;
      } catch (e) {
        return hash;
      }
    });
    _.forEach(shortHashes, (targetHash, sourceHash) => {
      content = content.replace(sourceHash, targetHash);
    });

    await fs.writeFile(fullPath, content);
  }
}

export {prepare, beforeCommit}
