#!/usr/bin/env zx
import { Chan } from 'chanpuru';
import 'zx/globals';
$.verbose = false;
function getSvg(sendErr) {
    const cmds = [
        () => $ `curl -sfL -o 'assets/images/stats-light.svg' -- 'https://github-readme-stats.vercel.app/api?username=hankei6km&show_icons=true'`,
        () => $ `curl -sfL -o 'assets/images/stats-dark.svg' -- 'https://github-readme-stats.vercel.app/api?username=hankei6km&show_icons=true&theme=tokyonight'`,
        () => $ `curl -sfL -o 'assets/images/top-langs-light.svg' -- 'https://github-readme-stats.vercel.app/api/top-langs/?username=hankei6km&layout=compact'`,
        () => $ `curl -sfL -o 'assets/images/top-langs-dark.svg' -- 'https://github-readme-stats.vercel.app/api/top-langs/?username=hankei6km&layout=compact&theme=tokyonight'`
    ];
    const ch = new Chan(1);
    (async () => {
        let aborted = false;
        for (const cmd of cmds) {
            if (aborted) {
                break;
            }
            const p = cmd();
            p.catch(async (r) => {
                await sendErr(r);
                aborted = true;
            });
            await ch.send(p);
        }
        ch.close();
    })();
    return ch.receiver();
}
let exitStatus = 0;
try {
    const errCh = new Chan();
    (async () => {
        for await (const err of errCh.receiver()) {
            console.error(chalk.red(err));
            exitStatus = 1;
        }
    })();
    for await (const i of getSvg(errCh.send)) {
        if (i.exitCode !== 0) {
            throw new Error(`exitCode: ${i.exitCode}\nstdout: ${i.stdout}\nstdedd: ${i.stderr}\nsignal: ${i.signal}`);
        }
    }
    errCh.close();
}
catch (err) {
    console.error(chalk.red(err));
    exitStatus = 1;
}
process.exit(exitStatus);
