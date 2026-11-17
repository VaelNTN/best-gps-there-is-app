package com.bestgpsthereis.app;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "RadioIcy")
public class RadioIcyPlugin extends Plugin {
    private static final Pattern STREAM_TITLE_PATTERN = Pattern.compile("StreamTitle='([^']*)'");
    private final ExecutorService executor = Executors.newFixedThreadPool(8);

    @PluginMethod
    public void probeStations(PluginCall call) {
        JSArray urlsArr = call.getArray("urls");
        if (urlsArr == null || urlsArr.length() == 0) {
            JSObject empty = new JSObject();
            empty.put("results", new JSArray());
            call.resolve(empty);
            return;
        }

        List<String> urls = new ArrayList<>();
        int maxCount = Math.min(urlsArr.length(), 18);
        for (int i = 0; i < maxCount; i++) {
            String u = urlsArr.optString(i, "").trim();
            if (!u.isEmpty()) {
                urls.add(u);
            }
        }

        executor.submit(() -> {
            JSArray results = new JSArray();
            try {
                List<Callable<JSObject>> tasks = new ArrayList<>();
                for (String urlStr : urls) {
                    tasks.add(() -> probeSingle(urlStr));
                }
                List<Future<JSObject>> futures = executor.invokeAll(tasks, 6500, TimeUnit.MILLISECONDS);
                for (int i = 0; i < futures.size(); i++) {
                    Future<JSObject> f = futures.get(i);
                    String targetUrl = urls.get(i);
                    if (f.isDone() && !f.isCancelled()) {
                        try {
                            results.put(f.get());
                            continue;
                        } catch (Exception ignored) {
                        }
                    }
                    JSObject fallback = new JSObject();
                    fallback.put("url", targetUrl);
                    fallback.put("ok", false);
                    results.put(fallback);
                }
            } catch (Exception ignored) {
            }

            JSObject res = new JSObject();
            res.put("results", results);
            call.resolve(res);
        });
    }

    private JSObject probeSingle(String initialUrl) {
        JSObject obj = new JSObject();
        obj.put("url", initialUrl);
        obj.put("ok", false);
        obj.put("corsAllowed", false);
        obj.put("streamTitle", "");
        obj.put("icyName", "");
        obj.put("icyGenre", "");
        obj.put("bitrate", 0);

        HttpURLConnection conn = null;
        String currentUrl = initialUrl;

        try {
            for (int hop = 0; hop < 4; hop++) {
                URL u = new URL(currentUrl);
                conn = (HttpURLConnection) u.openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(3000);
                conn.setReadTimeout(2800);
                conn.setRequestProperty("User-Agent", "RoadMapperRadio/1.0");
                conn.setRequestProperty("Icy-MetaData", "1");
                conn.setRequestProperty("Accept", "*/*");
                conn.connect();

                int code = conn.getResponseCode();
                if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                    String loc = conn.getHeaderField("Location");
                    conn.disconnect();
                    conn = null;
                    if (loc == null || loc.isEmpty()) break;
                    URL resolved = new URL(u, loc);
                    currentUrl = resolved.toString();
                    continue;
                }

                if (code < 200 || code >= 400) {
                    return obj;
                }

                String ctype = safeHeader(conn, "Content-Type").toLowerCase(Locale.ROOT);
                if (ctype.contains("text/html") || ctype.contains("application/json")) {
                    return obj;
                }

                String cors = safeHeader(conn, "Access-Control-Allow-Origin");
                boolean corsAllowed = "*".equals(cors.trim()) || !cors.trim().isEmpty();
                String icyName = safeHeader(conn, "icy-name");
                String icyGenre = safeHeader(conn, "icy-genre");
                int bitrate = parseIntSafe(safeHeader(conn, "icy-br"));
                int metaInt = parseIntSafe(safeHeader(conn, "icy-metaint"));

                obj.put("resolvedUrl", currentUrl);
                obj.put("corsAllowed", corsAllowed);
                obj.put("icyName", icyName);
                obj.put("icyGenre", icyGenre);
                obj.put("bitrate", bitrate);

                InputStream is = conn.getInputStream();
                byte[] buf = new byte[4096];
                long startMs = System.currentTimeMillis();

                if (metaInt > 0 && metaInt <= 131072) {
                    // Read up to the first ICY metadata block
                    int remaining = metaInt;
                    int audioReadTotal = 0;
                    while (remaining > 0 && (System.currentTimeMillis() - startMs) < 2500) {
                        int n = is.read(buf, 0, Math.min(buf.length, remaining));
                        if (n <= 0) break;
                        remaining -= n;
                        audioReadTotal += n;
                    }
                    if (remaining == 0) {
                        int lenByte = is.read();
                        if (lenByte > 0) {
                            int metaLen = lenByte * 16;
                            ByteArrayOutputStream metaOut = new ByteArrayOutputStream();
                            int left = metaLen;
                            while (left > 0 && (System.currentTimeMillis() - startMs) < 2700) {
                                int n = is.read(buf, 0, Math.min(buf.length, left));
                                if (n <= 0) break;
                                metaOut.write(buf, 0, n);
                                left -= n;
                            }
                            String metaStr = new String(metaOut.toByteArray(), StandardCharsets.UTF_8);
                            Matcher m = STREAM_TITLE_PATTERN.matcher(metaStr);
                            if (m.find()) {
                                obj.put("streamTitle", m.group(1).trim());
                            }
                        }
                    }
                    obj.put("ok", audioReadTotal > 512);
                } else {
                    // Verify stream actively emits audio bytes
                    int n = is.read(buf, 0, buf.length);
                    obj.put("ok", n > 64);
                }
                return obj;
            }
        } catch (Exception ignored) {
        } finally {
            if (conn != null) {
                try {
                    conn.disconnect();
                } catch (Exception ignored) {
                }
            }
        }
        return obj;
    }

    private static String safeHeader(HttpURLConnection conn, String name) {
        String v = conn.getHeaderField(name);
        return v == null ? "" : v.trim();
    }

    private static int parseIntSafe(String raw) {
        try {
            return Integer.parseInt(raw.trim());
        } catch (Exception e) {
            return 0;
        }
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        super.handleOnDestroy();
    }
}
