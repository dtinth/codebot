const admZipPath = require.resolve('adm-zip')
const Module = require('module')
const util = require('util')

Module._resolveFilename = (original => function (request, requester) {
  if (request === 'adm-zip') {
    return admZipPath
  } else {
    return original.apply(this, arguments)
  }
})(Module._resolveFilename)

const axios = require('axios')
const cljs = require('clojurescript')

module.exports = function (context, callback) {
  Promise.all(context.body.events.map(processEvent))
    .then(r => callback(null, r), e => callback(e))

  function processEvent (event) {
    if (event.type === 'message') {
      return processMessageEvent(event)
    } else {
      console.log('Unknown event type:', event.type)
      console.log('The event being:', event)
      return Promise.resolve()
    }
  }

  function processMessageEvent (event) {
    const replyToken = event.replyToken
    return Promise.resolve(processMessage(event.message))
      .catch(e => `Error: ${e}`)
      .then(m => {
        const data = {
          replyToken,
          messages: [ { type: 'text', text: m } ]
        }
        return axios.post('https://api.line.me/v2/bot/message/reply', data, {
          headers: {
            'Authorization': `Bearer ${context.secrets.LINE_CHANNEL_ACCESS_TOKEN}`
          }
        })
      })
      .then(r => {
        return 'OK!'
      })
  }

  function processMessage (message) {
    try {
      if (message.type !== 'text') {
        return Promise.resolve('Sorry, I only process text messages...')
      }
      const out = [ ]
      const origLog = console.log
      const origErr = console.error
      console.log = function () {
        out.push(util.format.apply(util, arguments))
      }
      console.error = function () {
        out.push(util.format.apply(util, arguments))
      }
      try {
        const text = message.text
        const ctx = cljs.newContext()
        const res = cljs.eval(text, ctx)
        const str = cljs.eval('pr-str', ctx)(res)
        out.push(str)
      } finally {
        console.log = origLog
        console.error = origErr
      }
      return Promise.resolve(out.join('\n'))
    } catch (e) {
      return Promise.reject(e)
    }
  }
}
