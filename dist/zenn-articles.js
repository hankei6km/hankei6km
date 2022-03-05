#!/usr/bin/env zx
import 'zx/globals';
import { Octokit } from '@octokit/rest';
import { basename } from 'path';
import Parser from 'rss-parser';
import yaml from 'js-yaml';
import { h } from 'hastscript';
import { toHtml } from 'hast-util-to-html';
import { breakGenerator, chainSignal, Chan, timeoutPromise } from 'chanpuru';
$.verbose = false;
const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN
});
async function _emojiFromGitHub(signal, owner, repo, { title, link, filename }) {
    const res = octokit.rest.repos.getContent({
        owner,
        repo,
        path: `articles/${filename}.md`,
        request: {
            signal: signal
        }
    });
    try {
        const content = (await res).data.content;
        const lines = Buffer.from(content, 'base64').toString().split('\n');
        const idx = lines.findIndex((v) => {
            return v.startsWith('emoji:');
        });
        if (idx >= 0) {
            const emoji = yaml.load(lines[idx]).emoji;
            const q = new URLSearchParams({ emoji });
            const res = await fetch(`https://twemoji.deno.dev/api?${q.toString()}`);
            const twemoji = await res.text();
            return { title, link, emoji, twemoji };
        }
        return { title, link, emoji: '', twemoji: '' };
    }
    catch (err) {
        throw `${filename}\n${err}`;
    }
}
function emojiFromGitHub([cancelPromise, cancel], sendErr, workerNum, owner, repo, items) {
    const ch = new Chan(workerNum - 1);
    (async () => {
        const [chainedPromise, signal] = chainSignal(cancelPromise);
        let abortOwn = false;
        chainedPromise.catch(() => { });
        const handleAbort = () => {
            abortOwn = true;
        };
        signal.addEventListener('abort', handleAbort, { once: true });
        for await (const { title, link, filename } of breakGenerator(signal, items)) {
            const p = _emojiFromGitHub(signal, owner, repo, { title, link, filename });
            p.catch(async (err) => {
                if (!abortOwn) {
                    // コードが側からの kill 以外をエラーとする.
                    await sendErr(err);
                }
                cancel();
            });
            await ch.send(p);
        }
        signal.removeEventListener('abort', handleAbort);
        ch.close();
    })();
    return ch.receiver();
}
function zennFeed([cancelPromise, cancel], sendErr, account, limit) {
    const parser = new Parser();
    const ch = new Chan();
    (async () => {
        let cancelled = false;
        cancelPromise
            .catch(() => { }) // 今回はエラーの判別はしない.
            .finally(() => {
            cancelled = true;
        });
        try {
            const feed = await parser.parseURL(`https://zenn.dev/${account}/feed`);
            const items = feed.items.slice(0, limit > 0 ? limit : feed.items.length);
            for (const item of items) {
                if (cancelled) {
                    break;
                }
                if (item.title && item.link) {
                    const url = new URL(item.link);
                    const filename = basename(url.pathname);
                    await ch.send({ title: item.title, link: item.link, filename });
                }
            }
        }
        catch (r) {
            await sendErr(r);
            cancel();
        }
        finally {
            ch.close();
        }
    })();
    return ch.receiver();
}
async function main(account, owner, repo, workerNum, limit, timeout) {
    const [cancelPromise, cancel] = timeoutPromise(timeout);
    cancelPromise.catch(async (r) => {
        await errCh.send(r);
        cancel();
    });
    const errCh = new Chan(2);
    let exitStatus = 0;
    const recvItems = zennFeed([cancelPromise, cancel], errCh.send, account, limit);
    const recvOut = emojiFromGitHub([cancelPromise, cancel], errCh.send, workerNum, owner, repo, recvItems);
    (async () => {
        for await (const err of errCh.receiver()) {
            console.error(chalk.red(`error: ${err}`));
            exitStatus = 1;
        }
    })();
    const listItemsTree = [];
    for await (const { title, link, emoji, twemoji } of recvOut) {
        const twemojiImg = emoji
            ? h('img', {
                style: 
                // 'width:1em; height:1em; margin: 0 .05em 0 .1em; vertical-align: -0.1em;',
                // タイトル行のアイキャッチとしてつかうのでサイズ調整.
                'width:1.1em; height:1.1em; margin: 0 .5em 0 .1em; vertical-align: -0.1em;',
                width: '18',
                height: '18',
                alt: emoji,
                src: twemoji
            })
            : '';
        const titleTree = [
            h('a', { href: link }, twemojiImg ? [twemojiImg, ` ${title}`] : [title])
        ];
        listItemsTree.push(h('li', {}, titleTree));
    }
    errCh.close();
    cancel();
    if (exitStatus === 0) {
        process.stdout.write(toHtml(h('ul', {}, listItemsTree)));
        return 0;
    }
    return exitStatus;
}
let account = process.env['ACCOUNT'];
let owner = process.env['OWNER'];
let repo = process.env['REPO'];
let workerNum = 3;
let limit = 0;
let timeout = 30 * 1000;
if (typeof argv.account === 'string') {
    account = argv.account;
}
if (typeof argv.owner === 'string') {
    owner = argv.owner;
}
if (typeof argv.repo === 'string') {
    repo = argv.repo;
}
if (typeof argv['worker-num'] === 'number' && argv['worker-num'] > 0) {
    workerNum = argv['worker-num'];
}
if (typeof argv.limit === 'number' && argv.limit > 0) {
    limit = argv.limit;
}
if (typeof argv.timeout === 'number' && argv.timeout > 0) {
    timeout = argv.timeout;
}
if (account === undefined ||
    owner === undefined ||
    repo === undefined ||
    typeof argv.help === 'boolean') {
    console.log('USAGE: zenn-articles --acount [Zenn account] --owner [GitHub username] --repo [content repo] [--worker-num [number]] [--limit [number]] [--timeout [number]]');
    process.exit(1);
}
const exitStatus = await main(account, owner, repo, workerNum, limit, timeout);
process.exit(exitStatus);
