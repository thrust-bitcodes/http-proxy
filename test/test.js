let majesty = require('majesty')
let httpClient = require('http-client')

function exec(describe, it, beforeEach, afterEach, expect, should, assert) {

    describe("Testando proxy de requisições", function () {
        it('Deve acessar o server2 através do server1 um customServlet', function () {
            rs = httpClient.get('http://localhost:8778/test/hello')
              .fetch()
    
            expect(rs.code).to.equal(200)
            expect(rs.body).to.a('string')
            expect(rs.body).to.equal('helloFromServer2')
          })
    });
}

let res = majesty.run(exec)
exit(res.failure.length);