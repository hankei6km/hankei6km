#!/usr/bin/env zx
import 'zx/globals';
import { ProcessOutput } from 'zx';
import { basename } from 'path';
import Parser from 'rss-parser';
import yaml from 'js-yaml';
import { toMarkdown } from 'mdast-util-to-markdown';
import { breakGenerator, chainSignal, Chan, timeoutPromise } from 'chanpuru';
$.verbose = false;
function getContentProcess(owner, repo, filename) {
    return $ `gh api repos/${owner}/${repo}/contents/articles/${filename}.md --jq .content | base64 --decode | grep -e ^emoji: | head  -n 1`;
}
async function _emojiFromGitHub(signal, owner, repo, { title, link, filename }) {
    const zxProc = getContentProcess(owner, repo, filename);
    // 停止処理用の準備.
    zxProc
        .catch(() => {
        // cathc の処理は後続の await 側で行っている.
        // chain が分岐しているので unhandled の予防.
    })
        .finally(() => {
        signal.removeEventListener('abort', handleAbort);
    });
    const handleAbort = () => {
        zxProc.kill();
    };
    signal.addEventListener('abort', handleAbort, { once: true });
    // 受信結果の処理.
    try {
        const out = await zxProc;
        const emoji = yaml.load(out.stdout).emoji;
        return {
            title: `${emoji} ${title}`,
            link,
            filename
        };
    }
    catch (r) {
        throw `process error filename = ${filename}\n${r}`;
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
            p.catch(async (r) => {
                if (!abortOwn ||
                    (r instanceof ProcessOutput &&
                        (r.exitCode !== null || r.signal !== 'SIGTERM'))) {
                    // コードが側からの kill 以外をエラーとする.
                    await sendErr(r);
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
    const tree = {
        type: 'root',
        children: [{ type: 'list', children: [] }]
    };
    const list = tree.children[0];
    for await (const { title, link } of recvOut) {
        list.children.push({
            type: 'listItem',
            children: [
                {
                    type: 'paragraph',
                    children: [
                        {
                            type: 'link',
                            url: link,
                            children: [{ type: 'text', value: title }]
                        }
                    ]
                }
            ]
        });
    }
    errCh.close();
    cancel();
    if (exitStatus === 0) {
        console.log(toMarkdown(tree));
        return 0;
    }
    return exitStatus;
}
let account = '';
let owner = '';
let repo = '';
let workerNum = 3;
let limit = 0;
let timeout = 30 * 1000;
if (typeof argv.account === 'string' &&
    typeof argv.owner === 'string' &&
    typeof argv.repo === 'string') {
    account = argv.account;
    owner = argv.owner;
    repo = argv.repo;
}
else {
    console.log('USAGE: zenn-articles --acount [Zenn account] --owner [GitHub username] --repo [content repo] [--worker-num [number]] [--limit [number]]');
    process.exit(1);
}
if (typeof argv['worker-num'] === 'number' && argv['worker-num'] > 0) {
    workerNum = argv['worker-num'];
}
if (typeof argv['limit'] === 'number' && argv['limit'] > 0) {
    limit = argv['limit'];
}
const exitStatus = await main(account, owner, repo, workerNum, limit, timeout);
process.exit(exitStatus);
