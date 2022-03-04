#!/usr/bin/env zx
import 'zx/globals'
import { readFile } from 'fs/promises'
import { ProcessOutput } from 'zx'
import { Chan, ChanSend, select } from 'chanpuru'

$.verbose = false

function zennArticles(sendErr: ChanSend<any>) {
  const workerNum = 3
  const limit = 5
  const timeout = 30 * 1000
  const ch = new Chan<Promise<ProcessOutput>>()
  ;(async () => {
    const p = $`zx dist/zenn-articles.js --worker-num ${workerNum} --limit ${limit} --timeout ${timeout}`
    p.catch(async (r) => {
      sendErr(r)
      return Promise.reject(r)
    })
    await ch.send(p)
    ch.close()
  })()
  return ch.receiver()
}

function mardockCards(sendErr: ChanSend<any>) {
  const ch = new Chan<Promise<ProcessOutput>>()
  ;(async () => {
    const p = $`zx dist/mardock-card.js`
    p.catch(async (r) => {
      sendErr(r)
      return Promise.reject(r)
    })
    await ch.send(p)
    ch.close()
  })()
  return ch.receiver()
}

function oguraShuffle(sendErr: ChanSend<any>) {
  const ch = new Chan<Promise<ProcessOutput>>()
  ;(async () => {
    const p = $`zx dist/ogura-shuffle.js`
    p.catch(async (r) => {
      sendErr(r)
      return Promise.reject(r)
    })
    await ch.send(p)
    ch.close()
  })()
  return ch.receiver()
}

async function main(): Promise<number> {
  let exitStatus = 0
  try {
    const errCh = new Chan<any>()

    let md = (await readFile('templates/README-template.md')).toString('utf-8')

    const header = Math.floor(Math.random() * (4 - 1) + 1)
    md = md.replace(
      `:replace{#${'header'}}`,
      `assets/images/header${header}.jpg`
    )

    const s = {
      'zenn-articles': zennArticles(errCh.send),
      'mardock-cards': mardockCards(errCh.send),
      'ogura-shuffle': oguraShuffle(errCh.send)
    }

    ;(async () => {
      for await (const r of errCh.receiver()) {
        console.error(chalk.red(r))
        exitStatus = 1
      }
    })()
    for await (const [key, i] of select(s)) {
      if (!i.done) {
        md = md.replace(`:replace{#${key}}`, i.value.stdout)
      }
    }

    if (exitStatus === 0) {
      console.log(md)
    }
  } catch (err) {
    console.error(chalk.red(err))
    exitStatus = 1
  }
  return exitStatus
}

const exitStatus = await main()
process.exit(exitStatus)
