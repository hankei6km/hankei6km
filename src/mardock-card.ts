#!/usr/bin/env zx
import 'zx/globals'
import { h } from 'hastscript'
import { toHtml } from 'hast-util-to-html'
import Parser from 'rss-parser'

const parser = new Parser()

const feed = await parser.parseURL(
  `https://hankei6km.github.io/mardock/assets/feeds/deck.xml`
)
for (const item of feed.items.slice(0, 2)) {
  if (item.link && item.enclosure?.url) {
    const tree = h('a', { href: item.link }, [
      h('img', {
        alt: item.title,
        src: item.enclosure?.url,
        //width: '360'
        width: '270',
        height: '152'
      })
    ])
    console.log(toHtml(tree))
  }
}
