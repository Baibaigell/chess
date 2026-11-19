package com.chessapp;

import android.annotation.SuppressLint;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

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
 * https://appassets.androidplatform.net/assets/ 这个本地虚拟域名。
 * 该域名不经过真实网络，却拥有 https 的全部能力，
 * 于是 Worker、localStorage、相对路径引用都与普通网页一致。
 */
public class MainActivity extends AppCompatActivity {

    /** assets 的虚拟域名，WebViewAssetLoader 固定使用这个域名 */
    private static final String ASSET_DOMAIN = "appassets.androidplatform.net";

    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 全屏沉浸式：隐藏状态栏与导航栏，棋盘可以获得更大空间
        getWindow().setStatusBarColor(Color.parseColor("#16181c"));
        getWindow().setNavigationBarColor(Color.parseColor("#16181c"));

        // 用代码创建 WebView，避免布局文件与主题之间的耦合
        FrameLayout root = new FrameLayout(this);
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        root.setBackgroundColor(Color.parseColor("#16181c"));

        webView = new WebView(this);
        FrameLayout.LayoutParams wvParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT);
        webView.setLayoutParams(wvParams);
        webView.setBackgroundColor(Color.parseColor("#16181c"));

        root.addView(webView);
        setContentView(root);

        configureWebView();
        webView.loadUrl("https://" + ASSET_DOMAIN + "/assets/index.html");
    }

    private void configureWebView() {
        WebSettings s = webView.getSettings();

        // 前端是纯 JavaScript 应用，必须开启
        s.setJavaScriptEnabled(true);
        // 允许 localStorage（存档、状态持久化）
        s.setDomStorageEnabled(true);
        // Stockfish 的 wasm 需要
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);

        // 禁用缩放：棋盘自身已有响应式布局，页面级缩放会破坏布局
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);

        // 混合内容：所有资源都来自本地虚拟域名，无需放行明文
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        // 深色模式由 CSS 的 prefers-color-scheme 处理，这里不强制
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            s.setForceDark(WebSettings.FORCE_DARK_OFF);
        }

        // 使用 WebViewAssetLoader 拦截请求，从 assets 读取文件
        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .setDomain(ASSET_DOMAIN)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                // 前端代码里引擎路径写作 /engines/...（绝对路径），
                // 因此额外把根路径也挂到 assets 上，避免 404
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
                // 应用内不开外部链接：所有导航都留在 WebView 内
                String url = request.getUrl().toString();
                return !url.startsWith("https://" + ASSET_DOMAIN);
            }
        });
    }

    /** 返回键：优先让网页处理（未来可接入路由），否则退出 */
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
