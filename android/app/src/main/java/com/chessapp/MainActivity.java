package com.chessapp;

import android.annotation.SuppressLint;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.webkit.WebViewAssetLoader;

/**
 * 应用入口：用一个全屏 WebView 承载打包好的前端。
 *
 * 关键点：不能直接用 file:// 打开 assets 里的页面。
 * file:// 协议下浏览器安全策略禁止创建 Web Worker，
 * 本项目的电脑对手（Stockfish）依赖 Worker，会整个失效。
 * 同时 localStorage 在部分 Android 版本的 file:// 下也不可用。
 *
 * 因此改用 WebViewAssetLoader，把 assets 映射到
 * https://appassets.androidplatform.net/ 这个本地虚拟域名。
 * 该域名不经过真实网络，却拥有 https 的全部能力，
 * 于是 Worker、localStorage、相对路径引用都与普通网页一致。
 *
 * 路径映射（只有一个 / 处理器，指向 assets 根目录）：
 *   /index.html          -> assets/index.html
 *   /assets/app.js       -> assets/assets/app.js
 *   /engines/...         -> assets/engines/...
 *   /icons/...           -> assets/icons/...
 *
 * 早期版本额外挂了一个 /assets/ 处理器，导致 /assets/index.html
 * 被解析成 assets/assets/index.html（不存在），页面 404 黑屏。
 */
public class MainActivity extends AppCompatActivity {

    /** assets 的虚拟域名，WebViewAssetLoader 固定使用这个域名 */
    private static final String ASSET_DOMAIN = "appassets.androidplatform.net";

    /** 首页地址。注意没有 /assets/ 前缀 —— 见类注释里的路径映射 */
    private static final String START_URL = "https://" + ASSET_DOMAIN + "/index.html";

    /** 背景色，与网页主题一致，避免加载时闪白 */
    private static final String BG = "#16181c";

    private WebView webView;

    /** 出错时覆盖在 WebView 之上的提示层 */
    private TextView errorView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setStatusBarColor(Color.parseColor(BG));
        getWindow().setNavigationBarColor(Color.parseColor(BG));

        FrameLayout root = new FrameLayout(this);
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        root.setBackgroundColor(Color.parseColor(BG));

        webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        webView.setBackgroundColor(Color.parseColor(BG));
        root.addView(webView);

        root.addView(buildErrorView());

        setContentView(root);

        configureWebView();
        webView.loadUrl(START_URL);
    }

    /**
     * 构建错误提示层。
     *
     * 黑屏时用户看不到任何信息，无法自助排查。
     * 这里在加载失败或页面 console.error 时把原因显示出来，
     * 用户截个图就能定位问题。
     */
    private View buildErrorView() {
        ScrollView scroll = new ScrollView(this);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT);
        scroll.setLayoutParams(lp);
        scroll.setBackgroundColor(Color.parseColor(BG));
        scroll.setVisibility(View.GONE);
        scroll.setPadding(dp(20), dp(40), dp(20), dp(20));

        errorView = new TextView(this);
        errorView.setLayoutParams(new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));
        errorView.setTextColor(Color.parseColor("#e6e8eb"));
        errorView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        errorView.setGravity(Gravity.START);
        errorView.setTextIsSelectable(true);
        errorView.setTypeface(android.graphics.Typeface.MONOSPACE);
        // 初始未出错：把 TextView 放进 ScrollView，但整体隐藏
        scroll.addView(errorView);

        // 用一个容器把 ScrollView 包起来，方便整体显示/隐藏
        FrameLayout holder = new FrameLayout(this);
        holder.setLayoutParams(lp);
        holder.addView(scroll);
        holder.setVisibility(View.GONE);
        // 记住 scroll 供后面显示用
        errorHolder = holder;
        return holder;
    }

    /** 错误层的容器，显示/隐藏用它 */
    private View errorHolder;

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    /** 显示错误层；多次调用会追加内容 */
    private void showError(final String message) {
        runOnUiThread(() -> {
            if (errorHolder == null || errorView == null) return;
            CharSequence old = errorView.getText();
            String text = (old == null || old.length() == 0)
                    ? message
                    : old + "\n\n" + message;
            // 限制长度，避免刷屏
            if (text.length() > 4000) {
                text = text.substring(text.length() - 4000);
            }
            errorView.setText(text);
            errorHolder.setVisibility(View.VISIBLE);
        });
    }

    private void configureWebView() {
        WebSettings s = webView.getSettings();

        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);

        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);

        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            s.setForceDark(WebSettings.FORCE_DARK_OFF);
        }

        // 只挂一个根路径处理器，指向 assets 根目录
        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .setDomain(ASSET_DOMAIN)
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(
                    @NonNull WebView view,
                    @NonNull WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(
                    @NonNull WebView view,
                    @NonNull WebResourceRequest request) {
                String url = request.getUrl().toString();
                return !url.startsWith("https://" + ASSET_DOMAIN);
            }

            /** 资源加载失败（断网、找不到文件等） */
            @Override
            public void onReceivedError(
                    @NonNull WebView view,
                    @NonNull WebResourceRequest request,
                    @NonNull WebResourceError error) {
                // 只报告主文档的错误，子资源 404 太吵
                if (request.isForMainFrame()) {
                    showError("加载失败\n\n"
                            + "地址: " + request.getUrl() + "\n"
                            + "错误码: " + error.getErrorCode() + "\n"
                            + "说明: " + error.getDescription());
                }
            }

            /** HTTP 错误：assets 里没有这个文件时最典型的就是 404 */
            @Override
            public void onReceivedHttpError(
                    @NonNull WebView view,
                    @NonNull WebResourceRequest request,
                    @NonNull WebResourceResponse errorResponse) {
                Uri url = request.getUrl();
                String path = url.getPath();
                if (request.isForMainFrame() || "/index.html".equals(path)) {
                    showError("页面 404\n\n"
                            + "地址: " + url + "\n"
                            + "状态码: " + errorResponse.getStatusCode() + "\n\n"
                            + "可能原因：assets 里缺少文件，或路径映射不对。\n"
                            + "期望文件：assets/index.html");
                }
            }

            /** 兜底：页面加载完成后检查是否真的是我们的应用 */
            @Override
            public void onPageFinished(WebView view, String url) {
                view.evaluateJavascript(
                        "(function(){var r=document.getElementById('root');"
                                + "return r&&r.children.length>0?'ok':'empty';})()",
                        value -> {
                            if (value != null && value.contains("empty")) {
                                showError("页面已加载，但内容为空\n\n"
                                        + "地址: " + url + "\n\n"
                                        + "可能原因：JavaScript 执行失败。\n"
                                        + "请查看下方 console 输出。");
                            }
                        });
            }
        });

        // 转发网页 console 输出，方便在黑屏时看到 JS 报错
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(@NonNull ConsoleMessage msg) {
                ConsoleMessage.MessageLevel level = msg.messageLevel();
                if (level == ConsoleMessage.MessageLevel.ERROR) {
                    showError("JS 错误\n\n"
                            + msg.message() + "\n"
                            + (msg.sourceId() == null ? "" : msg.sourceId() + ":" + msg.lineNumber()));
                }
                return true;
            }
        });
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
