let HttpCookie = Java.type('java.net.HttpCookie');
let BasicHeader = Java.type('org.apache.http.message.BasicHeader');
let HeaderGroup = Java.type('org.apache.http.message.HeaderGroup');
let HttpServlet = Java.type('javax.servlet.http.HttpServlet');
let StringBuilder = Java.type('java.lang.StringBuilder');
let HttpHeaders = Java.type('org.apache.http.HttpHeaders');
let BasicHttpRequest = Java.type('org.apache.http.message.BasicHttpRequest');
let BasicHttpEntityEnclosingRequest = Java.type('org.apache.http.message.BasicHttpEntityEnclosingRequest');
let InputStreamEntity = Java.type('org.apache.http.entity.InputStreamEntity');
let URIUtils = Java.type('org.apache.http.client.utils.URIUtils');
let URI = Java.type('java.net.URI');
let EntityUtils = Java.type('org.apache.http.util.EntityUtils');
let HttpClientBuilder = Java.type('org.apache.http.impl.client.HttpClientBuilder');
let CookieSpecs = Java.type('org.apache.http.client.config.CookieSpecs');
let RequestConfig = Java.type('org.apache.http.client.config.RequestConfig');
let AbortableHttpRequest = Java.type('org.apache.http.client.methods.AbortableHttpRequest');
let HttpServletResponse = Java.type('javax.servlet.http.HttpServletResponse');
let Cookie = Java.type('javax.servlet.http.Cookie');

let hopByHopHeaders = new HeaderGroup();
[
    "Connection", "Keep-Alive",
    "Proxy-Authenticate", "Proxy-Authorization",
    "TE", "Trailers", "Transfer-Encoding", "Upgrade"
].forEach(function (header) {
    hopByHopHeaders.addHeader(new BasicHeader(header, null));
});

let _defaultOptions = {
    doPreserveHost: false,
    doPreserveCookies: false,
    doForwardIP: true,
    doLog: false,
    doHandleRedirects: false,
    connectTimeout: -1,
    readTimeout: -1
};

function service(proxyClient, options, servletRequest, servletResponse) {
    let method = servletRequest.getMethod();
    let targetURI = servletRequest.getRequestURI();

    let proxyRequestUri = rewriteUrlFromRequest(targetURI, servletRequest, options);

    let proxyRequest;

    if (servletRequest.getHeader(HttpHeaders.CONTENT_LENGTH) ||
        servletRequest.getHeader(HttpHeaders.TRANSFER_ENCODING)) {
        proxyRequest = newProxyRequestWithEntity(method, proxyRequestUri, servletRequest);
    } else {
        proxyRequest = new BasicHttpRequest(method, proxyRequestUri);
    }

    copyRequestHeaders(servletRequest, proxyRequest, options);

    if (options.doForwardIP) {
        setXForwardedForHeader(servletRequest, proxyRequest);
    }

    let proxyResponse = null;
    try {
        if (options.doLog) {
            let dest = options.targetHostObj.toString() + proxyRequest.getRequestLine().getUri();
            console.log('Proxying ', servletRequest.getRequestURI(), ' -- ', dest);
        }

        proxyResponse = proxyClient.execute(options.targetHostObj, proxyRequest);

        // Process the response:
        // Pass the response code. This method with the "reason phrase" is deprecated but it's the
        //   only way to pass the reason along too.
        let statusCode = proxyResponse.getStatusLine().getStatusCode();
        //noinspection deprecation
        servletResponse.setStatus(statusCode, proxyResponse.getStatusLine().getReasonPhrase());

        // Copying response headers to make sure SESSIONID or other Cookie which comes from the remote
        // server will be saved in client when the proxied url was redirected to another one.
        // See issue [#51](https://github.com/mitre/HTTP-Proxy-Servlet/issues/51)
        copyResponseHeaders(proxyResponse, servletRequest, servletResponse, targetURI, options);

        if (statusCode == HttpServletResponse.SC_NOT_MODIFIED) {
            // 304 needs special handling.  See:
            // http://www.ics.uci.edu/pub/ietf/http/rfc1945.html#Code304
            // Don't send body entity/content!
            servletResponse.setIntHeader(HttpHeaders.CONTENT_LENGTH, 0);
        } else {
            // Send the content to the client
            copyResponseEntity(proxyResponse, servletResponse, proxyRequest, servletRequest);
        }
    } catch (e) {
        if (proxyRequest instanceof AbortableHttpRequest) {
            proxyRequest.abort();
        }

        throw e;
    } finally {
        // make sure the entire entity was consumed, so the connection is released
        if (proxyResponse) {
            consumeQuietly(proxyResponse.getEntity());
        }

        //Note: Don't need to close servlet outputStream:
        // http://stackoverflow.com/questions/1159168/should-one-call-close-on-httpservletresponse-getoutputstream-getwriter
    }
}

/** Called from {@link #init(javax.servlet.ServletConfig)}.
 *  HttpClient offers many opportunities for customization.
 *  In any case, it should be thread-safe.
 **/
function createHttpClient(options) {
    return HttpClientBuilder.create()
        .setDefaultRequestConfig(buildRequestConfig(options)).build();
}

/**
 * Sub-classes can override specific behaviour of {@link org.apache.http.client.config.RequestConfig}.
 */
function buildRequestConfig(options) {
    return RequestConfig.custom()
        .setRedirectsEnabled(options.doHandleRedirects)
        .setCookieSpec(CookieSpecs.IGNORE_COOKIES) // we handle them in the servlet instead
        .setConnectTimeout(options.connectTimeout)
        .setSocketTimeout(options.readTimeout)
        .build();
}

/** HttpClient v4.1 doesn't have the
 * {@link org.apache.http.util.EntityUtils#consumeQuietly(org.apache.http.HttpEntity)} method. */
function consumeQuietly(entity) {
    try {
        EntityUtils.consume(entity);
    } catch (e) { //ignore
        log(e.getMessage(), e);
    }
}

/** Copy response body data (the entity) from the proxy to the servlet client. */
function copyResponseEntity(proxyResponse, servletResponse, proxyRequest, servletRequest) {
    let entity = proxyResponse.getEntity();

    if (entity) {
        let servletOutputStream = servletResponse.getOutputStream();
        entity.writeTo(servletOutputStream);
    }
}

/** Copy proxied response headers back to the servlet client. */
function copyResponseHeaders(proxyResponse, servletRequest, servletResponse, targetURI, options) {
    Java.from(proxyResponse.getAllHeaders()).forEach(function (header) {
        copyResponseHeader(servletRequest, servletResponse, header, targetURI, options);
    })
}

/** Copy a proxied response header back to the servlet client.
 * This is easily overwritten to filter out certain headers if desired.
 */
function copyResponseHeader(servletRequest, servletResponse, header, targetURI, options) {
    let headerName = header.getName();

    if (hopByHopHeaders.containsHeader(headerName))
        return;

    let headerValue = header.getValue();

    if (headerName.equalsIgnoreCase(org.apache.http.cookie.SM.SET_COOKIE) ||
        headerName.equalsIgnoreCase(org.apache.http.cookie.SM.SET_COOKIE2)) {
        copyProxyCookie(servletRequest, servletResponse, headerValue, options);
    } else if (headerName.equalsIgnoreCase(HttpHeaders.LOCATION)) {
        // LOCATION Header may have to be rewritten.
        servletResponse.addHeader(headerName, rewriteUrlFromResponse(servletRequest, headerValue, targetURI));
    } else {
        servletResponse.addHeader(headerName, headerValue);
    }
}

/** Copy cookie from the proxy to the servlet client.
 *  Replaces cookie path to local path and renames cookie to avoid collisions.
 */
function copyProxyCookie(servletRequest, servletResponse, headerValue, options) {
    let cookies = HttpCookie.parse(headerValue);
    let path = servletRequest.getContextPath() + servletRequest.getServletPath();

    // if (path.isEmpty()) {
    path = '/';
    // }

    cookies.forEach(function (cookie) {
        //set cookie name prefixed w/ a proxy value so it won't collide w/ other cookies
        let proxyCookieName = options.doPreserveCookies ? cookie.getName() : getCookieNamePrefix(cookie.getName()) + cookie.getName();
        let servletCookie = new Cookie(proxyCookieName, cookie.getValue());

        servletCookie.setComment(cookie.getComment());
        servletCookie.setMaxAge(Number(cookie.getMaxAge()));
        servletCookie.setPath(path); //set to the path of the proxy servlet

        // don't set cookie domain
        servletCookie.setSecure(cookie.getSecure());
        servletCookie.setVersion(cookie.getVersion());
        servletResponse.addCookie(servletCookie);
    });
}

/** For a redirect response from the target server, this translates {@code theUrl} to redirect to
  * and translates it to one the original client can use. */
function rewriteUrlFromResponse(servletRequest, theUrl, targetURI) {
    //TODO document example paths

    if (theUrl.startsWith(targetURI)) {
        /*-
         * The URL points back to the back-end server.
         * Instead of returning it verbatim we replace the target path with our
         * source path in a way that should instruct the original client to
         * request the URL pointed through this Proxy.
         * We do this by taking the current request and rewriting the path part
         * using this servlet's absolute path and the path from the returned URL
         * after the base target URL.
         */
        let curUrl = servletRequest.getRequestURL();//no query
        let pos;
        // Skip the protocol part
        if ((pos = curUrl.indexOf("://")) >= 0) {
            // Skip the authority part
            // + 3 to skip the separator between protocol and authority

            if ((pos = curUrl.indexOf("/", pos + 3)) >= 0) {
                // Trim everything after the authority part.
                curUrl.setLength(pos);
            }
        }
        // Context path starts with a / if it is not blank
        curUrl.append(servletRequest.getContextPath());
        // Servlet path starts with a / if it is not blank
        curUrl.append(servletRequest.getServletPath());
        curUrl.append(theUrl, targetURI.length(), theUrl.length());
        theUrl = curUrl.toString();
    }

    return theUrl;
}

function setXForwardedForHeader(servletRequest, proxyRequest) {
    let forHeaderName = 'X-Forwarded-For';
    let forHeader = servletRequest.getRemoteAddr();
    let existingForHeader = servletRequest.getHeader(forHeaderName);

    if (existingForHeader) {
        forHeader = existingForHeader + ', ' + forHeader;
    }

    proxyRequest.setHeader(forHeaderName, forHeader);
    proxyRequest.setHeader('X-Forwarded-Proto', servletRequest.getScheme());
}

function copyRequestHeaders(servletRequest, proxyRequest, options) {
    let enumerationOfHeaderNames = servletRequest.getHeaderNames();

    while (enumerationOfHeaderNames.hasMoreElements()) {
        let headerName = enumerationOfHeaderNames.nextElement();
        copyRequestHeader(servletRequest, proxyRequest, headerName, options);
    }
}

function copyRequestHeader(servletRequest, proxyRequest, headerName, options) {
    if (headerName.equalsIgnoreCase(HttpHeaders.CONTENT_LENGTH))
        return;

    if (hopByHopHeaders.containsHeader(headerName))
        return;

    let headers = servletRequest.getHeaders(headerName);

    while (headers.hasMoreElements()) {//sometimes more than one value
        let headerValue = headers.nextElement();

        // In case the proxy host is running multiple virtual servers,
        // rewrite the Host header to ensure that we get content from
        // the correct virtual server
        if (!options.doPreserveHost && headerName.equalsIgnoreCase(HttpHeaders.HOST)) {
            let host = options.targetHostObj;

            headerValue = host.getHostName();

            if (host.getPort() != -1) {
                headerValue += ':' + host.getPort();
            }
        } else if (!options.doPreserveCookies && headerName.equalsIgnoreCase(org.apache.http.cookie.SM.COOKIE)) {
            headerValue = getRealCookie(headerValue);
        }

        proxyRequest.addHeader(headerName, headerValue);
    }
}

/** Take any client cookies that were originally from the proxy and prepare them to send to the
 * proxy.  This relies on cookie headers being set correctly according to RFC 6265 Sec 5.4.
 * This also blocks any local cookies from being sent to the proxy.
 */
function getRealCookie(cookieValue) {
    let escapedCookie = new StringBuilder();
    let cookies = cookieValue.split(";");

    cookies.forEach(function (cookie) {
        let cookieSplit = cookie.split("=");

        if (cookieSplit.length == 2) {
            let cookieName = cookieSplit[0].trim();

            if (cookieName.startsWith(getCookieNamePrefix(cookieName))) {
                cookieName = cookieName.substring(getCookieNamePrefix(cookieName).length());

                if (escapedCookie.length() > 0) {
                    escapedCookie.append("; ");
                }

                escapedCookie.append(cookieName).append("=").append(cookieSplit[1].trim());
            }
        }
    });

    return escapedCookie.toString();
}

/** The string prefixing rewritten cookies. */
function getCookieNamePrefix(name) {
    return "!ThrustProxyServer!";
}

function newProxyRequestWithEntity(method, proxyRequestUri, servletRequest) {
    let eProxyRequest = new BasicHttpEntityEnclosingRequest(method, proxyRequestUri);

    eProxyRequest.setEntity(
        new InputStreamEntity(servletRequest.getInputStream(), getContentLength(servletRequest)));

    return eProxyRequest;
}

function getContentLength(request) {
    let contentLengthHeader = request.getHeader("Content-Length");

    if (contentLengthHeader) {
        return Number(contentLengthHeader);
    }

    return -1;
}

function rewriteUrlFromRequest(targetURI, servletRequest, options) {
    let uri = new StringBuilder(500);

    if (options.context) {
        uri.append('/').append(options.context);
    }

    uri.append(targetURI);

    // Handle the query string & fragment
    let queryString = servletRequest.getQueryString();//ex:(following '?'): name=value&foo=bar#fragment
    let fragment = null;

    //split off fragment from queryString, updating queryString if found
    if (queryString != null) {
        let fragIdx = queryString.indexOf('#');

        if (fragIdx >= 0) {
            fragment = queryString.substring(fragIdx + 1);
            queryString = queryString.substring(0, fragIdx);
        }
    }

    if (queryString != null && queryString.length() > 0) {
        uri.append('?');
        uri.append(queryString);
    }

    return uri.toString();
}

exports = function (options) {
    options = Object.assign({}, _defaultOptions, getConfig()['http-proxy'], options);
    options.targetHostObj = URIUtils.extractHost(new URI(options.targetHost));

    const proxyClient = createHttpClient(options);

    return service.bind(null, proxyClient, options);
};