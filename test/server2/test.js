function hello(params, request, response) {
    response.write('helloFromServer2');
}

exports = {
    hello: hello
}