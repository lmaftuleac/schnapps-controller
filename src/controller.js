const LayerNode = require('./layer-node')

const BRANCH_OPTS = {
  reroute: false
}

class Controller {
  constructor () {
    const self = this
    this.nodes = []
    this.endCallback = null
    this.catchCallback = null

    this.init = (...args) => {
      return this.start.apply(self, args)
    }
    this.do = this.do.bind(this)
    this.catch = this.catch.bind(this)
    this.end = this.end.bind(this)
    this.getFirstNode = this.getFirstNode.bind(this)
    this.getLastNode = this.getLastNode.bind(this)
    this.promise = this.promise.bind(this)
    this.toMiddleware = this.toMiddleware.bind(this)

    this.init.nodes = this.nodes
    this.init.getFirstNode = this.getFirstNode
    this.init.getLastNode = this.getLastNode
    this.init.promise = this.promise
    this.init.toMiddleware = this.toMiddleware
    this.init.do = this.do
    this.init.catch = this.catch
    this.init.end = this.end
    this.init.__self__ = this

    return this.init
  }

  /** Private */

  start (req, res, data) {
    const firstNode = this.getFirstNode()

    if (!firstNode) {
      throw new Error('No handlers found for curent controller')
    }

    // error callback for cycle runner
    const errCb = (err) => {
      if (this.catchCallback) {
        return this.catchCallback(req, res, err)
      }
      return Controller.__errorHandler(req, res, err)
    }

    // success callback for cycle runner
    const doneCb = (req, res, errCb, data) => {
      if (this.endCallback) {
        this.endCallback(req, res, errCb, data)
      }
    }

    return callNode(req, res, firstNode, data, errCb, doneCb)
  }

  getFirstNode () {
    if (this.nodes[0]) {
      return this.nodes[0]
    }
  }

  getLastNode () {
    if (this.nodes.length) {
      return this.nodes[this.nodes.length - 1]
    }
  }

  addNode (node) {
    const lastNode = this.getLastNode()
    if (lastNode) {
      lastNode.link(node)
    }
    this.nodes.push(node)
  }

  cloneNodes (nodes) {
    nodes.forEach((node) => {
      const { handler } = node
      const nodeCopy = new LayerNode(handler)
      this.addNode(nodeCopy)
    })
  }

  /** Public */

  do (handler) {
    if (
      typeof handler === 'function' &&
      !(handler.__self__ instanceof Controller)
    ) {
      // include handler function
      const node = new LayerNode(handler)
      this.addNode(node)
    } else if (
      typeof handler === 'function' &&
      handler.__self__ instanceof Controller
    ) {
      // include another Controller
      const childBranch = handler

      if (!childBranch.nodes.length) {
        throw new Error('Provided branch does not have nodes')
      }

      this.cloneNodes(childBranch.nodes)
    }
    return this.init
  }

  toMiddleware () {
    return (req, res, expressNext) => {
      const firstNode = this.getFirstNode()
      const doneCb = () => expressNext()
      callNode(req, res, firstNode, {}, Controller.__errorHandler, doneCb)
    }
  }

  promise (req, res, data) {
    return new Promise((resolve, reject) => {
      const firstNode = this.getFirstNode()

      const ok = (req, res, errCb, data) => {
        return resolve(data)
      }

      callNode(req, res, firstNode, data, reject, ok)
    })
  }

  catch (errorHandler) {
    if (typeof errorHandler === 'function') {
      this.catchCallback = errorHandler
    }
    return this.init
  }

  end (endCallback) {
    if (typeof endCallback === 'function') {
      this.endCallback = endCallback
    }
    return this.init
  }

  static __errorHandler (req, res, error) {
    res.send('SERVER ERROR')
  }

  static setDefaultErrorHandler (customErrorHandler) {
    Controller.__errorHandler = customErrorHandler
  }
}

const callNode = (req, res, node, customData, errCb, doneCb) => {
  let errorCalled = false
  let nextCalled = false

  const next = (...args) => {
    // prevent going into next if error was called previously
    if (errorCalled) {
      throw new Error('Cannot call Next after Error was called')
    }

    // prevent multiple next calls
    if (nextCalled) {
      throw new Error('next() was already called')
    }

    // mark as called
    nextCalled = true

    let branch, data, opts

    // get data inputs
    if (typeof args[0] === 'function' && (args[0].__self__ instanceof Controller)) {
      branch = args[0]
      opts = { ...BRANCH_OPTS, ...args[2] }
      data = args[1]
    } else {
      data = args[0]
    }

    // handle branch redirects
    if (branch) {
      const { reroute } = opts

      // re-routing to separate branch
      if (reroute) {
        return branch(req, res, data)
      }

      // call branch chain
      const branchNode = branch.getFirstNode()
      if (branchNode) {
        // success callback for child branch
        const doneWrapper = (req, res, errCb, data) => {
          if (node.nextNode) {
            return callNode(req, res, node.nextNode, data, errCb, doneCb)
          } else if (doneCb) {
            return doneCb(req, res, errCb, data)
          }
        }

        // start branch chain
        return callNode(req, res, branchNode, data, errCb, doneWrapper)
      } else {
        throw new Error('Provided branch does not have nodes')
      }
    }

    // continue to next handler
    if (node.nextNode) {
      return callNode(req, res, node.nextNode, data, errCb, doneCb)
    } else if (doneCb) {
      return doneCb(req, res, errCb, data)
    }
  }

  const error = err => {
    // prevent going into next if error was called previously
    if (errorCalled) {
      throw new Error('error() was already called')
    }

    // prevent multiple next calls
    if (nextCalled) {
      throw new Error('Cannot call Error after Next was called')
    }

    // mark as called
    errorCalled = true

    return errCb(err)
  }

  return node.handler(req, res, next, error, customData)
}

module.exports = {
  Controller,
  callNode
}
