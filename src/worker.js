// RESOLVE.JS 开始
// 配置常量
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
const accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7';
const acceptLanguage = 'zh-CN,zh;q=0.9';

// 工具函数部分
function isEmpty(val) {
  return val === '' || val === null || val === undefined || 
         (typeof val === 'object' && Object.keys(val).length === 0) || 
         (Array.isArray(val) && val.length === 0);
}

// 从 ajaxm.php 响应的 URL 中提取更多文件信息
async function getMoreInfoFromAjaxmPHPResponseURL(ajaxmPHPResponseURL) {
  let redirectedURL;
  const resp = await fetch(ajaxmPHPResponseURL, {
    headers: {
      'user-agent': userAgent,
      accept,
      'accept-encoding': 'gzip',
      'accept-language': acceptLanguage,
      connection: 'keep-alive',
    },
    method: 'HEAD',
    redirect: 'manual',
  });

  if (resp.headers.has('location')) {
    redirectedURL = new URL(resp.headers.get('location'));
    redirectedURL.searchParams.delete('pid');
    const fileResp = await fetch(redirectedURL, {
      headers: {
        'user-agent': userAgent,
        'accept-encoding': 'gzip',
        connection: 'keep-alive',
      },
    });

    if (fileResp.headers.has('content-length')) {
      const disposition = fileResp.headers.get('content-disposition');
      const filename = decodeURIComponent(
        disposition.match(/filename\*?=(?:UTF-8'')?["']?(.*)["']?/)[1]
      );
      return {
        length: Number(fileResp.headers.get('content-length')),
        redirectedURL,
        filename,
      };
    } else {
      throw new Error("Response missing 'Content-Length' header.");
    }
  } else {
    throw new Error("'ajaxm.php' response was not redirected.");
  }
}

// 创建用于 ajaxm.php 的请求体
function createAjaxmPHPBody(body) {
  return new URLSearchParams(body).toString();
}

// 核心类 LinkResolver：处理蓝奏云链接解析
class LinkResolver {
  constructor(options) {
    if (typeof options.url === 'string') {
      options.url = new URL(options.url);
    }
    this.options = Object.freeze(options);
  }

  async resolve() {
    const pageURL = new URL(this.options.url.pathname, 'https://www.lanzoup.com');
    const result = {
      downURL: null,
      filename: '',
      filesize: 0,
    };

    const html = await (await fetch(pageURL, {
      headers: {
        accept,
        'accept-language': acceptLanguage,
        'accept-encoding': 'gzip, deflate',
        'user-agent': userAgent,
        connection: 'keep-alive',
      },
      method: 'GET',
    })).text();

    // 页面关闭检查（直接匹配 HTML 字符串）
    if (html.includes('<div class="off">')) {
      const msg = html.match(/<div class="off">.*?<\/div>/)?.[0];
      throw new Error(msg && msg.includes('文件取消分享') ? 'File unshared.' : 'Unknown page closure reason.');
    }

    const hasPassword = html.includes('<input type="password" id="pwd">');
    if (hasPassword) {
      if (!this.options.password) {
        throw new Error('Password required.');
      }

      // 处理带密码的文件解析
      const resp = await (await fetch(
        `https://www.lanzoup.com/ajaxm.php${html.match(/'*ajaxm.php(.*?)'/)[1]}`,
        {
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            referer: pageURL.toString(),
            origin: pageURL.origin,
            'x-requested-with': 'XMLHttpRequest',
            connection: 'keep-alive',
          },
          body: createAjaxmPHPBody({
            action: 'downprocess',
            sign: html.match(/skdklds = '(.*?)'/)[1],
            p: this.options.password,
            kd: html.match(/kdns =(.*?)/)?.[1] ?? '0',
          }),
          method: 'POST',
        }
      )).json();

      if (resp.zt) {
        result.downURL = new URL('/file/' + resp.url, resp.dom);
        result.filename = resp.inf;

        const moreInfo = await getMoreInfoFromAjaxmPHPResponseURL(result.downURL);
        result.filesize = moreInfo.length;
        result.downURL = moreInfo.redirectedURL;
      } else {
        throw new Error(resp.inf === '密码不正确' ? 'Password incorrect.' : 'Unknown ajaxm.php response.');
      }
    } else {
      // 处理无需密码的文件解析
      const iframeSrc = html.match(/<iframe.*?class="ifr2".*?src="(.*?)".*?>/)[1];
      const iframeURL = new URL(iframeSrc, pageURL.origin);
      const iframeHTML = await (await fetch(iframeURL, {
        headers: {
          accept,
          'accept-language': acceptLanguage,
          'accept-encoding': 'gzip, deflate',
          'user-agent': userAgent,
          connection: 'keep-alive',
        },
        method: 'GET',
      })).text();

      const resp = await (await fetch(
        `https://www.lanzoup.com/ajaxm.php${iframeHTML.match(/'*ajaxm.php(.*?)'/)[1]}`,
        {
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            referer: iframeURL.toString(),
            origin: iframeURL.origin,
            'x-requested-with': 'XMLHttpRequest',
            connection: 'keep-alive',
          },
          body: createAjaxmPHPBody({
            action: 'downprocess',
            sign: iframeHTML.match(/'sign':'(.*?)'/)[1],
            websign: iframeHTML.match(/ciucjdsdc = '(.*?)'/)[1],
            websignkey: iframeHTML.match(/aihidcms = '(.*?)'/)[1],
            ves: iframeHTML.match(/'ves':(.*?),/)[1],
            kd: iframeHTML.match(/kdns =(.*?)/)?.[1] ?? '0',
          }),
          method: 'POST',
        }
      )).json();

      if (resp.zt) {
        result.downURL = new URL('/file/' + resp.url, resp.dom);

        const moreInfo = await getMoreInfoFromAjaxmPHPResponseURL(result.downURL);
        result.filesize = moreInfo.length;
        result.filename = moreInfo.filename;
        result.downURL = moreInfo.redirectedURL;
      } else {
        throw new Error('Unknown ajaxm.php response.');
      }
    }

    return result;
  }
}
// RESOLVE.JS 结束

// Cloudflare Worker 主逻辑
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const lanzouLink = url.searchParams.get("url");
    const password = url.searchParams.get("pwd");
    const debug = url.searchParams.get("debug") === "true";

    if (!lanzouLink) {
      return new Response(
        JSON.stringify({ error: "参数 'url' 是必需的！" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    try {
      const resolver = new LinkResolver({
        url: lanzouLink,
        password: password || undefined,
      });

      const result = await resolver.resolve();

      const responseData = {
        downloadUrl: result.downURL.href,
        filename: result.filename,
        filesize: result.filesize,
      };

      if (debug) {
        responseData.debugInfo = { originalResult: result, requestUrl: lanzouLink };
      }

      return new Response(JSON.stringify(responseData), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: "解析链接时发生错误。",
          details: error.message,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  },
};
