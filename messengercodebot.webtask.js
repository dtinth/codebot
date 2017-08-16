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

var app = new (require('express'))()
var wt = require('webtask-tools')

app.use(require('body-parser').json())
app.use(require('body-parser').urlencoded({ extended: false }))

app.get('/', function (req, res) {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === req.webtaskContext.secrets.MESSENGER_VERIFY_TOKEN) {
    res.status(200).send(req.query['hub.challenge'])
  } else {
    console.error('Failed validation. Make sure the validation tokens match.')
    res.sendStatus(403)
  }
})

app.post('/', function (req, res) {
  var data = req.body
  var sender = createSender(req.webtaskContext.secrets.PAGE_ACCESS_TOKEN)
  if (data.object === 'page') {
    Promise.all(
      data.entry.map(entry =>
        Promise.all(entry.messaging.map(event => {
          if (event.message) {
            return receivedMessage(event, sender)
          } else {
            console.log('Webhook received unknown event: ', event)
          }
        }))
      )
    ).then(() => {
      res.sendStatus(200)
    }, (e) => {
      console.error(e)
      res.sendStatus(500)
    })
  } else {
    console.error('WTF unknown object', data)
    res.sendStatus(400)
  }
})

function receivedMessage (event, sender) {
  var senderID = event.sender.id
  var message = event.message
  var messageText = message.text
  if (messageText) {
    console.log('Handle message', event)
    return processMessage(messageText)
      .then(result => {
        return sender.send(senderID, result)
      })
  } else {
    console.log('Unknown message', event)
  }
}

function createSender (accessToken) {
  return {
    send (recipientId, messages) {
      const messageText = typeof messages === 'string' ? messages : messages.join('\n')
      var messageData = {
        recipient: {
          id: recipientId
        },
        message: {
          text: messageText
        }
      }
      return axios.post(
        'https://graph.facebook.com/v2.6/me/messages?access_token=' + accessToken,
        messageData
      )
      .then(r => r.data)
      .catch(e => {
        if (e.response.data && e.response.data.error) {
          console.error('Send error', e.response.data.error)
          throw new Error('Send error')
        }
      })
    }
  }
}

module.exports = wt.fromExpress(app)

function processMessage (messageText) {
  return Promise.resolve().then(() => {
    const originalCode = messageText
    const code = formatCode(originalCode)
    return axios.get('https://dtinth.lib.id/cljs@dev/?code=' + encodeURIComponent(code))
    .then(
      resp => {
        const out = [ ]
        if (originalCode !== code) {
          out.push(
            'ℹ️ ' +
            (
              code.trim().includes('\n')
              ? 'Auto-closing parens based on indentation (parinfer)'
              : 'Auto-closing parens'
            )
          )
        }
        out.push(
          '😁 ' +
          resp.data
        )
        return out
      }
    )
  }).catch(e => {
    if (
      e.response &&
      e.response.data &&
      e.response.data.error &&
      e.response.data.error.type &&
      e.response.data.error.message
    ) {
      return `😢 [${e.response.status}] ${e.response.data.error.type}: ${e.response.data.error.message}`
    }
    return `😤 ${e}`
  })
}
