const server = require('http')
const router = require('router')
const httpProxy = require('../../dist/index')

server.createServer(8778, router, {
    servlets: {
        httpProxy: {
            paths: ['/*'],
            service: httpProxy({
                targetHost: 'http://localhost:8779',
            })
        }
    }
})