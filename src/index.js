var scan = require('./scan');

// beef是为了支持客户端amd模块
global.require = require('beef');

var contentType = 'text/json;charset=utf-8';
var timeoutSpan = 100;

// 接受配置参数
exports.config = function(config) {
    if (config && config.dir) {
        scan.scanDir(config.dir);
    }
};


// 封装数据
function pack(obj) {
    return JSON.stringify(obj, '\t', 4);
}

// 对外暴露的service接口
exports.serve = function(request, response) {
    var query= request.query; // 请求参数
    var path = query.path; //请求路径信息
    var param = query.param;

    if (!path) {
        response.end(pack({
            status: 200,
            url: request.query
        }));
        return;
    }

    // 所有/转为_；方便mock接口命名
    path = path.replace(/\//g, '_');

    // 如果是post过来的请求
    if (request.body) {
        var body = request.body.toString();
        body = require('querystring').parse(body);
        if (body.param) {
            try {
                param = JSON.parse(body.param);
            } catch(ex) {}
        }
    } else if (param && 'string' == typeof param) {
        try {
            param = JSON.parse(param);
        } catch(ex) {}
    }

    // 从服务列表中获取处理函数
    var proc = scan.getResponse(path);

    if (proc && 'function' == typeof proc) {
        var result = {status: 500, data: null};
        try {
            result = proc(path, param);
            if (result && result.status) {
                response.writeHead(result.status, contentType);
            } else if (result) {
                response.writeHead(200, contentType);
            } else {
                result = {
                    timeout: 3000,
                    data: 'service error'
                };
                response.writeHead(500, contentType);
            }

            // 延迟响应请求， 默认为100ms
            setTimeout(function() {
                delete result.timeout;
                response.end(pack(result));
            }, result.timeout || timeoutSpan);

            // 成功处理要直接退出
            return;
        } catch(ex) {
            // 如果出现脚本错误；默认发送的是500错误
            result.data = {
                msg: 'script error'
            };
            console.log('runtime error', path);
        } finally {
            // 处理错误情况的响应
            response.end(pack(result));
        }
    } else {

        response.writeHead(404, contentType);
        response.end(pack({
            status: 404,
            msg: 'not found'
        }));
    }
};

function service(request, response) {
    var url = require('url').parse(request.url, true);
    request.query = url.query;

    if (request.method == 'POST') {
        var data = [];

        request.on('data', function(trunk) {
            data.push(trunk && trunk.toString());
        });

        request.on('end', function(trunk) {
            if (trunk) {
                data.push(trunk.toString());
            }
            
            request.body = data.join('');
            // 转给通用处理函数处理
            exports.serve(request, response);
        });

    } else {
        exports.serve(request, response);
    }
}

// 独立服务运行
exports.listen = function(port) {
    port || (port = 8181);
    require('http').createServer(service).listen(port);
    console.log('mockservice start on port:' + port);
};

// 为edp提供暴露接口
exports.request = function(config) {
    var me = this;
    me.config(config);
    return function(context) {
        var request = context.request;
        var response = context.response;
        request.body = request.bodyBuffer;
        me.serve(request, response);
    };
};