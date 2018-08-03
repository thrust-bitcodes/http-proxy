http-proxy [![Build Status](https://travis-ci.org/thrust-bitcodes/http-proxy.svg?branch=master)](https://travis-ci.org/thrust-bitcodes/http-proxy)
===============

http-proxy é um *bitcode* para [thrust](https://github.com/thrustjs/thrust) utilizado para realizar proxy de requisições http.

# Instalação

Posicionado em um app [thrust](https://github.com/thrustjs/thrust), no seu terminal:

```bash
thrust install http-proxy
```

## Tutorial
```javascript
const http = require('http')
const router = require('router')
const httpProxy = require('http-proxy')

server.createServer(port, router, {
    servlets: {
        httpProxy: {
            paths: ['/*'],
            service: httpProxy({
                targetHost: 'http://localhost:8779',
            })
        }
    }
})
```

Acima estamos criando um servlet customizado no http que irá redirecionar todos os requests feitos em /* para o servidor 8779

## Parâmetros de configuração
As propriedades abaixo podem ser configuradas no arquivo *config.json* (distribuído juntamente com o ThrustJS) ou no options da biblioteca:

``` javascript
{
  ...
  "http-proxy": { /*Configuração do http-proxy */
    "targetHost": /*String Host de destino das chamadas*/,
    "contextPath": /*String contexto que será adicionado ao host nas chamdas*/,
  }
}

```

Acesse também os outros *bitcodes* utilizados no exemplo para melhor entendimento:

- [thrust-bitcodes/http](https://github.com/thrust-bitcodes/http)
- [thrust-bitcodes/router](https://github.com/thrust-bitcodes/router)


Esta biblioteca foi transcrita a partir de [HTTP-Proxy-Servlet](https://github.com/mitre/HTTP-Proxy-Servlet)