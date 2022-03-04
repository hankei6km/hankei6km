#!/usr/bin/env zx
import 'zx/globals';
import { h } from 'hastscript';
import { toHtml } from 'hast-util-to-html';
$.verbose = false;
const res = await fetch('https://api.sssapi.app/4CiDkGyE9Yb5KH2JSwYgf');
const content = await res.json();
const h3 = h('h3', {}, [content['karuta:firstHalf']]);
console.log(toHtml(h3));
const p = h('p', {}, [
    h('details', {}, [
        h('summary', {}, ['下の句']),
        h('p', {}, [content['karuta:secondHalf']])
    ]),
    h('ul', {}, [
        h('li', {}, [
            `歌人 - `,
            h('a', { href: content['dcterms:creator'] }, [content['dcterms:creator']])
        ]),
        h('li', {}, [
            `読札 - `,
            h('a', { href: content['karuta:imageOfYomi'] }, [
                content['karuta:imageOfYomi']
            ])
        ])
    ])
]);
process.stdout.write(toHtml(p));
