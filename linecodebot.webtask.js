const admZipPath = require.resolve('adm-zip')
const Module = require('module')

// Ugly hack to make `clojurescript` npm module work in webtask.io
Module._resolveFilename = (original => function (request, requester) {
  if (request === 'adm-zip') {
    return admZipPath
  } else {
    return original.apply(this, arguments)
  }
})(Module._resolveFilename)
const cljs = require('clojurescript')

const axios = require('axios')
const parinfer = require('parinfer')

function formatCode (code) {
  try {
    try {
      cljs.context.cljs.reader.read_string(code)
    } catch (e) {
      if (!/EOF while reading/.test(e.message)) throw e
      const inferredCode = parinfer.indentMode(code).text
      const oldLines = code.split('\n')
      const newLines = inferredCode.split('\n')
      if (
        oldLines.length === newLines.length &&
        newLines.every((to, i) => to.trim().startsWith(oldLines[i].trim()))
      ) {
        return inferredCode
      }
    }
  } catch (e) {
    return code
  }
  return code
}

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
        const ms = typeof m === 'string' ? [ m ] : m
        const data = {
          replyToken,
          messages: ms.map(msg => ({ type: 'text', text: String(msg) }))
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
      const originalCode = message.text
      const code = formatCode(originalCode)
      return axios.get('https://dtinth.lib.id/cljs@dev/?code=' + encodeURIComponent(code))
      .then(
        resp => {
          const out = [ ]
          if (originalCode !== code) {
            out.push(
              String.fromCodePoint(0x100085) + ' ' +
              (
                code.trim().includes('\n')
                ? 'Auto-closing parens based on indentation (parinfer)'
                : 'Auto-closing parens'
              )
            )
          }
          out.push(
            String.fromCodePoint(0x10008D) + ' ' +
            resp.data
          )
          return out
        },
        e => {
          if (
            e.response &&
            e.response.data &&
            e.response.data.error &&
            e.response.data.error.type &&
            e.response.data.error.message
          ) {
            return `${String.fromCodePoint(0x10007E)} [${e.response.status}] ${e.response.data.error.type}: ${e.response.data.error.message}`
          }
          return `${String.fromCodePoint(0x10007D)} ${e}`
        }
      )
    } catch (e) {
      return Promise.reject(e)
    }
  }
}
