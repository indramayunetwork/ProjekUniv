import { connect } from "cloudflare:sockets";

const DEFAULT_PROXY_BANK_URL = "https://raw.githubusercontent.com/InconigtoVPN/InconigtoVPN/refs/heads/main/iplist.txt";

// Global Variables
let cachedProxyList = [];
let proxyIP = "";
let apiCheck = "https://ipcf.rmtq.fun/json/?ip=";

// Constants
const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSING = 2;

async function getProxyList(env, forceReload = false) {
  if (!cachedProxyList.length || forceReload) {
    const proxyBankUrl = env.PROXY_BANK_URL || DEFAULT_PROXY_BANK_URL;
    const proxyBankResponse = await fetch(proxyBankUrl);

    if (proxyBankResponse.ok) {
      const proxyLines = (await proxyBankResponse.text()).split("\n").filter(Boolean);
      cachedProxyList = proxyLines.map((line) => {
        const [proxyIP, proxyPort, country, org] = line.split(",");
        return { proxyIP, proxyPort, country, org };
      });
    }
  }
  return cachedProxyList;
}

async function checkIPAndPort(ip, port) {
  const apiUrl = `${apiCheck}${ip}:${port}`;
  try {
    const apiResponse = await fetch(apiUrl);
    const apiData = await apiResponse.json();
    const result = {
      ip: ip,
      port: port,
      status: apiData.STATUS || null
    };
    return new Response(JSON.stringify(result, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json;charset=utf-8" }
    });
  } catch (err) {
    return new Response(`An error occurred while fetching API: ${err.toString()}`, {
      status: 500,
    });
  }
}



export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const upgradeHeader = request.headers.get("Upgrade");

      // Map untuk menyimpan proxy per country code
      const proxyState = new Map();

      // Fungsi untuk memperbarui proxy setiap menit
      async function updateProxies() {
        const proxies = await getProxyList(env);
        const groupedProxies = groupBy(proxies, "country");

        for (const [countryCode, proxies] of Object.entries(groupedProxies)) {
          const randomIndex = Math.floor(Math.random() * proxies.length);
          proxyState.set(countryCode, proxies[randomIndex]);
        }

        console.log("Proxy list updated:", Array.from(proxyState.entries()));
      }

      // Jalankan pembaruan proxy setiap menit
      ctx.waitUntil(
        (async function periodicUpdate() {
          await updateProxies();
          setInterval(updateProxies, 60000); // Setiap 60 detik
        })()
      );

      if (upgradeHeader === "websocket") {
        // Match path dengan format /CC atau /CCangka
        const pathMatch = url.pathname.match(/^\/([A-Z]{2})(\d+)?$/);

        if (pathMatch) {
          const countryCode = pathMatch[1];
          const index = pathMatch[2] ? parseInt(pathMatch[2], 10) - 1 : null;

          console.log(`Country Code: ${countryCode}, Index: ${index}`);

          // Ambil proxy berdasarkan country code
          const proxies = await getProxyList(env);
          const filteredProxies = proxies.filter((proxy) => proxy.country === countryCode);

          if (filteredProxies.length === 0) {
            return new Response(`No proxies available for country: ${countryCode}`, { status: 404 });
          }

          let selectedProxy;

          if (index === null) {
            // Ambil proxy acak dari state jika ada
            selectedProxy = proxyState.get(countryCode) || filteredProxies[0];
          } else if (index < 0 || index >= filteredProxies.length) {
            return new Response(
              `Index ${index + 1} out of bounds. Only ${filteredProxies.length} proxies available for ${countryCode}.`,
              { status: 400 }
            );
          } else {
            selectedProxy = filteredProxies[index];
          }

          proxyIP = `${selectedProxy.proxyIP}:${selectedProxy.proxyPort}`;
          console.log(`Selected Proxy: ${proxyIP}`);
          return await websockerHandler(request);
        }

        // Match path dengan format ip:port atau ip=port
        const ipPortMatch = url.pathname.match(/^\/(.+[:=-]\d+)$/);

        if (ipPortMatch) {
          proxyIP = ipPortMatch[1].replace(/[=:-]/, ":"); // Standarisasi menjadi ip:port
          console.log(`Direct Proxy IP: ${proxyIP}`);
          return await websockerHandler(request, proxyIP);
        }
      }
      
      const inconigto = url.hostname;
      const type = url.searchParams.get('type') || 'mix';
      const tls = url.searchParams.get('tls') !== 'false';
      const wildcard = url.searchParams.get('wildcard') === 'true';
      const bugs = url.searchParams.get('bug') || inconigto;
      const inconigtomode = wildcard ? `${bugs}.${inconigto}` : inconigto;
      const country = url.searchParams.get('country');
      const limit = parseInt(url.searchParams.get('limit'), 10); // Ambil nilai limit
      let configs;

      if (url.pathname.startsWith("/")) {
        const pathParts = url.pathname.slice(1).split(":");
        if (pathParts.length === 2) {
          const [ip, port] = pathParts;
          return await checkIPAndPort(ip, port);
        }
      }

      switch (url.pathname) {
        case '/sub/clash':
          configs = await generateClashSub(type, bugs, inconigtomode, tls, country, limit);
          break;
        case '/sub/surfboard':
          configs = await generateSurfboardSub(type, bugs, inconigtomode, tls, country, limit);
          break;
        case '/sub/singbox':
          configs = await generateSingboxSub(type, bugs, inconigtomode, tls, country, limit);
          break;
        case '/sub/husi':
          configs = await generateHusiSub(type, bugs, inconigtomode, tls, country, limit);
          break;
        case '/sub/nekobox':
          configs = await generateNekoboxSub(type, bugs, inconigtomode, tls, country, limit);
          break;
        case '/sub/v2rayng':
          configs = await generateV2rayngSub(type, bugs, inconigtomode, tls, country, limit);
          break;
        case '/sub/v2ray':
          configs = await generateV2raySub(type, bugs, inconigtomode, tls, country, limit);
          break;
        case "/sub":
          return new Response(await handleSubRequest(url.hostname), { headers: { 'Content-Type': 'text/html' } })
          break;
        default:
            const hostname = request.headers.get("Host");
            const result = getAllConfig(hostname, await getProxyList(env, true));
            return new Response(result, {
              status: 200,
              headers: { "Content-Type": "text/html;charset=utf-8" },
            });
      }

      return new Response(configs);
    } catch (err) {
      return new Response(`An error occurred: ${err.toString()}`, {
        status: 500,
      });
    }
  },
};

// Helper function: Group proxies by country
function groupBy(array, key) {
  return array.reduce((result, currentValue) => {
    (result[currentValue[key]] = result[currentValue[key]] || []).push(currentValue);
    return result;
  }, {});
}

function getAllConfig(hostName, proxyList) {
  const encodePath = (proxyIP, proxyPort) => {
    // Remove spaces and then encode
    const cleanedProxyIP = proxyIP.trim(); // Remove leading and trailing spaces
    return `%2F${encodeURIComponent(cleanedProxyIP)}%3D${encodeURIComponent(proxyPort)}`;
  };

  const encodeSpace = (string) => {
    return encodeURIComponent(string).replace(/\s+/g, ''); // Remove spaces entirely
  };

  const proxyListElements = proxyList.map(({ proxyIP, proxyPort, country, org }, index) => {
    const pathcode = encodePath(proxyIP, proxyPort);
    const encodedCountry = encodeSpace(country);
    const encodedOrg = encodeSpace(org);
    const clashpath = `/${proxyIP}-${proxyPort}`.replace(/\s+/g, '');

    const status = `${proxyIP}:${proxyPort}`;
    const vlessTls = `vless://${crypto.randomUUID()}@${hostName}:443?encryption=none&security=tls&sni=${hostName}&fp=randomized&type=ws&host=${hostName}&path=${pathcode}#(${encodedCountry})${encodedOrg}-[Tls]`;
    const vlessNTls = `vless://${crypto.randomUUID()}@${hostName}:80?encryption=none&security=none&sni=${hostName}&fp=randomized&type=ws&host=${hostName}&path=${pathcode}#(${encodedCountry})${encodedOrg}-[NTls]`;
    const trojanTls = `trojan://${crypto.randomUUID()}@${hostName}:443?encryption=none&security=tls&sni=${hostName}&fp=randomized&type=ws&host=${hostName}&path=${pathcode}#(${encodedCountry})${encodedOrg}-[Tls]`;
    const trojanNTls = `trojan://${crypto.randomUUID()}@${hostName}:80?encryption=none&security=none&sni=${hostName}&fp=randomized&type=ws&host=${hostName}&path=${pathcode}#(${encodedCountry})${encodedOrg}-[NTls]`;
    const ssTls = `ss://${btoa(`none:${crypto.randomUUID()}`)}@${hostName}:443?encryption=none&type=ws&host=${hostName}&path=${pathcode}&security=tls&sni=${hostName}#${encodedCountry}${encodedOrg}-[Tls]`;
    const ssNTls = `ss://${btoa(`none:${crypto.randomUUID()}`)}@${hostName}:80?encryption=none&type=ws&host=${hostName}&path=${pathcode}&security=none&sni=${hostName}#${encodedCountry}${encodedOrg}-[NTls]`;
    const clashVLTls = `
#InconigtoVPN
proxies:
- name: (${country}) ${org}-[Tls]-[VL]
  server: ${hostName}
  port: 443
  type: vless
  uuid: ${crypto.randomUUID()}
  cipher: auto
  tls: true
  client-fingerprint: chrome
  udp: true
  skip-cert-verify: true
  network: ws
  servername: ${hostName}
  alpn:
    - h2
    - h3
    - http/1.1
  ws-opts:
    path: ${clashpath}
    headers:
      Host: ${hostName}
    max-early-data: 0
    early-data-header-name: Sec-WebSocket-Protocol
    ip-version: dual
    v2ray-http-upgrade: false
    v2ray-http-upgrade-fast-open: false
    `;

    const clashTRTls =`
#InconigtoVPN
proxies:      
- name: (${country}) ${org}-[Tls]-[TR]
  server: ${hostName}
  port: 443
  type: trojan
  password: ${crypto.randomUUID()}
  tls: true
  client-fingerprint: chrome
  udp: true
  skip-cert-verify: true
  network: ws
  sni: ${hostName}
  alpn:
    - h2
    - h3
    - http/1.1
  ws-opts:
    path: ${clashpath}
    headers:
      Host: ${hostName}
    max-early-data: 0
    early-data-header-name: Sec-WebSocket-Protocol
    ip-version: dual
    v2ray-http-upgrade: false
    v2ray-http-upgrade-fast-open: false
    `;

    const clashSSTls =`
#InconigtoVPN
proxies:
- name: (${country}) ${org}-[Tls]-[SS]
  server: ${hostName}
  port: 443
  type: ss
  cipher: none
  password: ${crypto.randomUUID()}
  plugin: v2ray-plugin
  client-fingerprint: chrome
  udp: true
  plugin-opts:
    mode: websocket
    host: ${hostName}
    path: ${clashpath}
    tls: true
    mux: false
    skip-cert-verify: true
  headers:
    custom: value
    ip-version: dual
    v2ray-http-upgrade: false
    v2ray-http-upgrade-fast-open: false
    `;
    const escapedClashSSTls = clashSSTls.replace(/\n/g, '\\n').replace(/"/g, '\\"');
    const escapedClashVLTls = clashVLTls.replace(/\n/g, '\\n').replace(/"/g, '\\"');
    const escapedClashTRTls = clashTRTls.replace(/\n/g, '\\n').replace(/"/g, '\\"');
    
    // Combine all configurations into one string
    const allconfigs = [
      ssTls,
      ssNTls,
      vlessTls,
      vlessNTls,
      trojanTls,
      trojanNTls,
    ].join('\n\n');
    
    // Encode the string for use in JavaScript
    const encodedAllconfigs = encodeURIComponent(allconfigs);
    
    
    return `
      <div class="content ${index === 0 ? "active" : ""}">
        <h2>Inconigto-VPN</h2>
        <hr class="config-divider" />
        <h2>VLESS TROJAN SHADOWSOCKS</h2>
        <h2>CloudFlare</h2>
        <hr class="config-divider"/>
        <center><h1><strong> Country : </strong>${country} </h1></center>
        <center><h1><strong> ISP : </strong>${org} </h1></center>
        <center><h1><strong> ProxyIP : </strong>${proxyIP}:${proxyPort}</h1></center>
        <center><button class="button" onclick="fetchAndDisplayAlert('${status}')">Proxy Status</button></center>
    
        <hr class="config-divider" />
    
        <strong><h2>VLESS</h2></strong>
        <h1>Vless Tls</h1>
        <pre>${vlessTls}</pre>
        <button onclick="copyToClipboard('${vlessTls}')">Copy Vless TLS</button><br>
        <h1>Vless NTls</h1>
        <pre>${vlessNTls}</pre>
        <button onclick="copyToClipboard('${vlessNTls}')">Copy Vless N-TLS</button><br>
        <h1>Clash Vless TLS</h1>
        <pre>${clashVLTls}</pre>
    
        <hr class="config-divider" />
    
        <strong><h2>TROJAN</h2></strong>
        <h1>Trojan TLS</h1>
        <pre>${trojanTls}</pre>
        <button onclick="copyToClipboard('${trojanTls}')">Copy Trojan TLS</button>
        <h1>Trojan N-TLS</h1>
        <pre>${trojanNTls}</pre>
        <button onclick="copyToClipboard('${trojanNTls}')">Copy Trojan N-TLS</button>
        <h1>Clash Trojan TLS</h1>
        <pre>${clashTRTls}</pre>
    
        <hr class="config-divider" />
    
        <strong><h2>SHADOWSOCKS</h2></strong>
        <h1>Shadowsocks TLS</h1>
        <pre>${ssTls}</pre>
        <button onclick="copyToClipboard('${ssTls}')">Copy Shadowsocks TLS</button>
        <h1>Shadowsocks N-TLS</h1>
        <pre>${ssNTls}</pre>
        <button onclick="copyToClipboard('${ssNTls}')">Copy Shadowsocks N-TLS</button>
        <h1>Clash Shadowsocks TLS</h1>
        <pre>${clashSSTls}</pre>
    
        <hr class="config-divider" />
        <h2>All Configs</h2>
        <center><button onclick="copyToClipboard(decodeURIComponent('${encodedAllconfigs}'))">Copy All Configs</button></center>
        <hr class="config-divider" /> 
        <h2>Generate SUB</h2>
        <center><button onclick="window.open('https://${hostName}/sub')">Generate SUB</button></center>
        <hr class="config-divider" /> 
      </div>`;
    })
    .join("");
  return `
    <html>
      <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
      <title>Inconigto-VPN | VPN Tunnel | CloudFlare</title>
      
      <!-- SEO Meta Tags -->
      <meta name="description" content="Akun Vless Gratis. Inconigto-VPN offers free Vless accounts with Cloudflare and Trojan support. Secure and fast VPN tunnel services.">
      <meta name="keywords" content="Inconigto-VPN, Free Vless, Vless CF, Trojan CF, Cloudflare, VPN Tunnel, Akun Vless Gratis">
      <meta name="author" content="Inconigto-VPN">
      <meta name="robots" content="index, follow"> <!-- Enable search engines to index the page -->
      <meta name="robots" content="noarchive"> <!-- Prevent storing a cached version of the page -->
      <meta name="robots" content="max-snippet:-1, max-image-preview:large, max-video-preview:-1"> <!-- Improve visibility in search snippets -->
      
      <!-- Social Media Meta Tags -->
      <meta property="og:title" content="Inconigto-VPN | Free Vless & Trojan Accounts">
      <meta property="og:description" content="Inconigto-VPN provides free Vless accounts and VPN tunnels via Cloudflare. Secure, fast, and easy setup.">
      <meta property="og:image" content="https://raw.githubusercontent.com/akulelaki696/bg/refs/heads/main/20250106_010158.jpg"> <!-- Image to appear in previews -->
      <meta property="og:url" content="https://vip.rtmq.fun"> <!-- Your website URL -->
      <meta property="og:type" content="website">
      <meta property="og:site_name" content="Inconigto-VPN">
      <meta property="og:locale" content="en_US"> <!-- Set to your language/locale -->
      
      <!-- Twitter Card Meta Tags -->
      <meta name="twitter:card" content="summary_large_image">
      <meta name="twitter:title" content="Inconigto-VPN | Free Vless & Trojan Accounts">
      <meta name="twitter:description" content="Get free Vless accounts and fast VPN services via Cloudflare with Inconigto-VPN. Privacy and security guaranteed.">
      <meta name="twitter:image" content="https://raw.githubusercontent.com/akulelaki696/bg/refs/heads/main/20250106_010158.jpg"> <!-- Image for Twitter -->
      <meta name="twitter:site" content="@InconigtoVPN">
      <meta name="twitter:creator" content="@InconigtoVPN">
      
      <!-- Telegram Meta Tags -->
      <meta property="og:image:type" content="image/jpeg"> <!-- Specify the image type for Telegram and other platforms -->
      <meta property="og:image:secure_url" content="https://raw.githubusercontent.com/akulelaki696/bg/refs/heads/main/20250106_010158.jpg"> <!-- Secure URL for image -->
      <meta property="og:audio" content="URL-to-audio-if-any"> <!-- Optionally add audio for Telegram previews -->
      <meta property="og:video" content="URL-to-video-if-any"> <!-- Optionally add video for Telegram previews -->
      
      <!-- Additional Meta Tags -->
      <meta name="theme-color" content="#000000"> <!-- Mobile browser theme color -->
      <meta name="format-detection" content="telephone=no"> <!-- Prevent automatic phone number detection -->
      <meta name="generator" content="Inconigto-VPN">
      <meta name="google-site-verification" content="google-site-verification-code"> <!-- Google verification -->
      
      <!-- Open Graph Tags for Rich Links -->
      <meta property="og:image:width" content="1200">
      <meta property="og:image:height" content="630">
      <meta property="og:image:alt" content="Inconigto-VPN Image Preview">
      
      <!-- Favicon and Icon links -->
      <link rel="icon" href="https://raw.githubusercontent.com/AFRcloud/BG/main/icons8-film-noir-80.png" type="image/png">
      <link rel="apple-touch-icon" href="https://raw.githubusercontent.com/AFRcloud/BG/main/icons8-film-noir-80.png">
      <link rel="manifest" href="/manifest.json">
        

      
      <style>
      html, body {
        height: 100%;
        width: 100%;
        overflow: hidden;
        background-color: #1a1a1a;
        font-family: 'Roboto', Arial, sans-serif;
        margin: 0;
      }
    
      body {
        display: flex;
        background: url('https://raw.githubusercontent.com/bitzblack/ip/refs/heads/main/shubham-dhage-5LQ_h5cXB6U-unsplash.jpg') no-repeat center center fixed;
        background-size: cover;
        justify-content: center;
        align-items: center;
      }
    
      .popup {
        width: 100vw;
        height: 90vh;
        border-radius: 15px;
        background-color: rgba(0, 0, 0, 0.0);
        backdrop-filter: blur(5px);
        display: grid;
        grid-template-columns: 1.5fr 3fr;
        overflow: hidden;
        animation: popupEffect 1s ease-in-out;
      }
    
      @keyframes popupEffect {
        0% { transform: scale(0.8); opacity: 0; }
        100% { transform: scale(1); opacity: 1; }
      }
    
      .tabs {
        background-color: rgba(0, 0, 0, 0.0);
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        overflow-y: auto;
        overflow-x: hidden;
        border-right: 5px solid #00FFFF;
        box-shadow: inset 0 0 15px rgba(0, 255, 255, 0.3);
      }
    
      .author-link {
        position: absolute;
        bottom: 10px;
        right: 10px;
        font-weight: bold;
        font-style: italic;
        color: #00FFFF;
        font-size: 1rem;
        text-decoration: none;
        z-index: 10;
      }
    
      .author-link:hover {
        color: #0FF;
        text-shadow: 0px 0px 10px rgba(0, 255, 255, 0.8);
      }
    
      label {
        font-size: 14px;
        cursor: pointer;
        color: #00FFFF;
        padding: 12px;
        background: linear-gradient(90deg, #000, #333);
        border-radius: 10px;
        text-align: left;
        transition: background 0.3s ease, transform 0.3s ease;
        box-shadow: 0px 4px 8px rgba(0, 255, 255, 0.4);
        white-space: normal;
        overflow-wrap: break-word;
      }
    
      label:hover {
        background: #00FFFF;
        color: #000;
        transform: translateY(-4px);
        box-shadow: 0px 8px 16px rgba(0, 255, 255, 0.2);
      }
    
      input[type="radio"] {
        display: none;
      }
    
      .tab-content {
        padding: 0px 0px 0px 10px;
        overflow-y: auto;
        color: #00FFFF;
        font-size: 12px;
        background-color: rgba(0, 0, 0, 0.8);
        height: 100%;
        box-sizing: border-box;
        border-radius: 10px;
        box-shadow: inset 0 0 20px rgba(0, 255, 255, 0.2);
      }
    

      .content {
        display: none;
        padding-right: 15px;
        
      }
    
      .content.active {
        display: block;
        animation: fadeIn 0.5s ease;
      }
    
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
    
      h1 {
        font-size: 18px;
        color: #00FFFF;
        margin-bottom: 10px;
        text-shadow: 0px 0px 10px rgba(0, 255, 255, 0.5);
      }
    
      h2 {
        font-size: 22px;
        color: #00FFFF;
        text-align: center;
        text-shadow: 0px 0px 10px rgba(0, 255, 255, 0.5);
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 8px;
      }
    
      pre {
        background-color: rgba(0, 0, 0, 0.2);
        padding: 5px;
        border-radius: 5px;
        font-size: 12px;
        white-space: pre-wrap;
        word-wrap: break-word;
        color: #00FFFF;
        border: 1px solid #00FFFF;
        box-shadow: 0px 6px 10px rgba(0, 255, 255, 0.4);
      }
    
      .config-divider {
        border: none;
        height: 2px;
        background: linear-gradient(to right, transparent, #00FFFF, transparent);
        margin: 40px 0;
      }
    
      .config-description {
        font-weight: bold;
        font-style: italic;
        color: #00FFFF;
        font-size: 14px;
        text-align: justify;
        margin: 0 10px;
      }
    
      button {
        padding: 9px 12px;
        border: none;
        border-radius: 5px;
        background-color: #00FFFF;
        color: #111;
        cursor: pointer;
        font-weight: bold;
        display: block;
        text-align: left;
        box-shadow: 0px 6px 10px rgba(0, 255, 255, 0.4);
        transition: background-color 0.3s ease, transform 0.3s ease;
      }
    
      button:hover {
        background-color: #0FF;
        transform: translateY(-3px);
        box-shadow: 0px 6px 10px rgba(0, 255, 255, 0.4);
      }
    
      #search {
        background: #333;
        color: #00FFFF;
        border: 1px solid #00FFFF;
        border-radius: 6px;
        padding: 5px;
        margin-bottom: 10px;
        width: 100%;
        box-shadow: 0px 4px 8px rgba(0, 255, 255, 0.3);
      }
    
      #search::placeholder {
        color: #00FFFF;
      }
    
      .watermark {
        position: absolute;
        bottom: 10px;
        left: 50%;
        transform: translateX(-50%);
        font-size: 1rem;
        color: #00FFFF;
        text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
        font-weight: bold;
        text-align: center;
      }
    
      .watermark a {
        color: #00FFFF;
        text-decoration: none;
        font-weight: bold;
      }
    
      .watermark a:hover {
        color: #00FFFF;
      }
    
      @media (max-width: 768px) {
        .header h1 { font-size: 32px; }
        .config-section h3 { font-size: 24px; }
        .config-block h4 { font-size: 20px; }
      }
    </style>
    
  </head>
  <body>
    <div class="popup">
      <div class="tabs">
        <input type="text" id="search" placeholder="Search by Country" oninput="filterTabs()">
        ${proxyList
          .map(
            ({ country, org }, index) => `
              <input type="radio" id="tab${index}" name="tab" ${index === 0 ? "checked" : ""}>
              <label for="tab${index}" class="tab-label" data-country="${country.toLowerCase()}">${org} (${country})</label>
            `
          )
          .join("")}
      </div>
      <div class="tab-content">${proxyListElements}</div>
    </div>
    <br>
    <a href="https://t.me/inconigtobot" class="watermark" target="_blank">Inconigto-Bot</a>
    <a href="https://t.me/Inconigt0" class="author-link" target="_blank">Inconigto-VPN</a>
    <script>
  function filterTabs() {
    const query = document.getElementById('search').value.toLowerCase();
    const labels = document.querySelectorAll('.tab-label');
    labels.forEach(label => {
      const isVisible = label.dataset.country.includes(query);
      label.style.display = isVisible ? "block" : "none";
    });
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text)
        .then(() => {
            showPopup("Copied to clipboard!");
        })
        .catch((err) => {
            console.error("Failed to copy to clipboard:", err);
        });
  }

  function fetchAndDisplayAlert(path) {
    fetch(path)
        .then(response => {
            if (!response.ok) {
                throw new Error(\`HTTP error! Status: \${response.status}\`);
            }
            return response.json();
        })
        .then(data => {
            const status = data.status || "Unknown status";
            showPopup(\`Proxy Status: \${status}\`);
        })
        .catch((err) => {
            alert("Failed to fetch data or invalid response.");
        });
  }

  function showPopup(message) {
    const popup = document.createElement('div');
    popup.textContent = message;
    popup.style.position = 'fixed';
    popup.style.top = '10%';
    popup.style.left = '50%';
    popup.style.transform = 'translate(-50%, -50%)'; // Center the popup
    popup.style.backgroundColor = 'rgba(0, 255, 255, 0.8)'; // Neon Blue Transparent Background
    popup.style.color = 'black';
    popup.style.padding = '10px';
    popup.style.border = '3px solid black';
    popup.style.fontSize = '14px';
    popup.style.width = '130px'; // Consistent width
    popup.style.height = '20px'; // Consistent height
    popup.style.borderRadius = '15px'; // Rounded corners
    popup.style.boxShadow = '0 10px 20px rgba(0, 0, 0, 0.3)'; // Strong shadow for depth
    popup.style.opacity = '0';
    popup.style.transition = 'opacity 0.5s ease, transform 0.5s ease'; // Smooth transitions for opacity and transform
    popup.style.display = 'flex';
    popup.style.alignItems = 'center';
    popup.style.justifyContent = 'center';
    popup.style.textAlign = 'center';
    popup.style.zIndex = '1000'; // Ensure it's on top

    // Adding a little bounce animation when it appears
    popup.style.transform = 'translate(-50%, -50%) scale(0.5)'; // Start smaller for zoom effect
    document.body.appendChild(popup);

    // Apply animation for smooth transition
    setTimeout(() => {
        popup.style.opacity = '1';
        popup.style.transform = 'translate(-50%, -50%) scale(1)'; // Zoom in effect
    }, 100);

    // Hide the popup after 2 seconds
    setTimeout(() => {
        popup.style.opacity = '0';
        popup.style.transform = 'translate(-50%, -50%) scale(0.5)'; // Shrink back for zoom effect
        setTimeout(() => {
            document.body.removeChild(popup);
        }, 100); // Remove the popup after animation ends
    }, 3000);
  }

  document.querySelectorAll('input[name="tab"]').forEach((tab, index) => {
    tab.addEventListener('change', () => {
      document.querySelectorAll('.content').forEach((content, idx) => {
        content.classList.toggle("active", idx === index);
      });
    });
  });
</script>


  
  </body>
</html>
  `;
}




async function handleSubRequest(hostnem) {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<title>Inconigto-VPN | VPN Tunnel | CloudFlare</title>

<!-- SEO Meta Tags -->
<meta name="description" content="Akun Vless Gratis. Inconigto-VPN offers free Vless accounts with Cloudflare and Trojan support. Secure and fast VPN tunnel services.">
<meta name="keywords" content="Inconigto-VPN, Free Vless, Vless CF, Trojan CF, Cloudflare, VPN Tunnel, Akun Vless Gratis">
<meta name="author" content="Inconigto-VPN">
<meta name="robots" content="index, follow"> <!-- Enable search engines to index the page -->
<meta name="robots" content="noarchive"> <!-- Prevent storing a cached version of the page -->
<meta name="robots" content="max-snippet:-1, max-image-preview:large, max-video-preview:-1"> <!-- Improve visibility in search snippets -->

<!-- Social Media Meta Tags -->
<meta property="og:title" content="Inconigto-VPN | Free Vless & Trojan Accounts">
<meta property="og:description" content="Inconigto-VPN provides free Vless accounts and VPN tunnels via Cloudflare. Secure, fast, and easy setup.">
<meta property="og:image" content="https://raw.githubusercontent.com/akulelaki696/bg/refs/heads/main/20250106_010158.jpg"> <!-- Image to appear in previews -->
<meta property="og:url" content="https://vip.rtmq.fun"> <!-- Your website URL -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="Inconigto-VPN">
<meta property="og:locale" content="en_US"> <!-- Set to your language/locale -->

<!-- Twitter Card Meta Tags -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Inconigto-VPN | Free Vless & Trojan Accounts">
<meta name="twitter:description" content="Get free Vless accounts and fast VPN services via Cloudflare with Inconigto-VPN. Privacy and security guaranteed.">
<meta name="twitter:image" content="https://raw.githubusercontent.com/akulelaki696/bg/refs/heads/main/20250106_010158.jpg"> <!-- Image for Twitter -->
<meta name="twitter:site" content="@InconigtoVPN">
<meta name="twitter:creator" content="@InconigtoVPN">

<!-- Telegram Meta Tags -->
<meta property="og:image:type" content="image/jpeg"> <!-- Specify the image type for Telegram and other platforms -->
<meta property="og:image:secure_url" content="https://raw.githubusercontent.com/akulelaki696/bg/refs/heads/main/20250106_010158.jpg"> <!-- Secure URL for image -->
<meta property="og:audio" content="URL-to-audio-if-any"> <!-- Optionally add audio for Telegram previews -->
<meta property="og:video" content="URL-to-video-if-any"> <!-- Optionally add video for Telegram previews -->

<!-- Additional Meta Tags -->
<meta name="theme-color" content="#000000"> <!-- Mobile browser theme color -->
<meta name="format-detection" content="telephone=no"> <!-- Prevent automatic phone number detection -->
<meta name="generator" content="Inconigto-VPN">
<meta name="google-site-verification" content="google-site-verification-code"> <!-- Google verification -->

<!-- Open Graph Tags for Rich Links -->
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Inconigto-VPN Image Preview">

<!-- Favicon and Icon links -->
<link rel="icon" href="https://raw.githubusercontent.com/AFRcloud/BG/main/icons8-film-noir-80.png" type="image/png">
<link rel="apple-touch-icon" href="https://raw.githubusercontent.com/AFRcloud/BG/main/icons8-film-noir-80.png">
<link rel="manifest" href="/manifest.json">
<style>
    :root {
        --color-primary: #00d4ff; /* Biru neon */
        --color-secondary: #00bfff; /* Biru lebih terang */
        --color-background: #020d1a; /* Latar belakang lebih gelap */
        --color-card: rgba(0, 212, 255, 0.1); /* Kartu dengan sedikit transparansi */
        --color-text: #e0f4f4; /* Tetap dengan teks cerah */
        --transition: all 0.3s ease;
    }

    * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        outline: none;
    }

    body {
        display: flex;
        background: url('https://raw.githubusercontent.com/bitzblack/ip/refs/heads/main/shubham-dhage-5LQ_h5cXB6U-unsplash.jpg') no-repeat center center fixed;
        background-size: cover;
        justify-content: center;
        align-items: flex-start; /* Align items to the top */
        color: var(--color-text);
        min-height: 100vh;
        font-family: 'Arial', sans-serif;
        overflow-y: auto; /* Memungkinkan scrolling */
    }

    .container {
        width: 100%;
        max-width: 500px;
        padding: 2rem;
        max-height: 90vh; /* Batasi tinggi agar tidak melebihi viewport */
        overflow-y: auto; /* Membolehkan scroll jika konten lebih tinggi */
    }

    .card {
        background: var(--color-card);
        border-radius: 16px;
        padding: 2rem;
        box-shadow: 0 10px 30px rgba(0, 212, 255, 0.1); /* Biru neon */
        backdrop-filter: blur(10px);
        border: 1px solid rgba(0, 212, 255, 0.2); /* Biru neon */
        transition: var(--transition);
    }

    .card:hover {
        box-shadow: 0 20px 60px rgba(0, 212, 255, 0.3); /* Glow lebih kuat */
    }

    .title {
        text-align: center;
        color: var(--color-primary); /* Biru neon */
        margin-bottom: 1.5rem;
        font-size: 2rem;
        font-weight: 700;
        animation: titleFadeIn 1s ease-out;
    }

    @keyframes titleFadeIn {
        0% { opacity: 0; transform: translateY(-20px); }
        100% { opacity: 1; transform: translateY(0); }
    }

    .form-group {
        margin-bottom: 1rem;
    }

    .form-group label {
        display: block;
        margin-bottom: 0.5rem;
        color: var(--color-text);
        font-weight: 500;
    }

    .form-control {
        width: 100%;
        padding: 0.75rem 1rem;
        background: rgba(0, 212, 255, 0.05); /* Biru neon */
        border: 2px solid rgba(0, 212, 255, 0.3); /* Biru neon */
        border-radius: 8px;
        color: var(--color-text);
        transition: var(--transition);
    }

    .form-control:focus {
        border-color: var(--color-secondary); /* Biru lebih terang */
        box-shadow: 0 0 8px 3px rgba(0, 255, 255, 0.7); /* Biru neon */
    }

    .btn {
        width: 100%;
        padding: 0.75rem;
        background: var(--color-primary); /* Biru neon */
        color: var(--color-background);
        border: none;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
        transition: var(--transition);
        position: relative;
        overflow: hidden;
    }

    .btn::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 300%;
        height: 300%;
        background: rgba(0, 255, 255, 0.3);
        transition: all 0.4s ease;
        border-radius: 50%;
        transform: translate(-50%, -50%) scale(0);
    }

    .btn:hover::after {
        transform: translate(-50%, -50%) scale(1);
    }

    .btn:hover {
        background: var(--color-secondary); /* Biru lebih terang */
        box-shadow: 0 0 20px 10px rgba(0, 255, 255, 0.3); /* Glow saat hover */
    }

    .result {
        margin-top: 1rem;
        padding: 1rem;
        background: rgba(0, 212, 255, 0.1); /* Biru neon */
        border-radius: 8px;
        word-break: break-all;
        opacity: 0;
        animation: fadeIn 1s ease-out forwards;
    }

    @keyframes fadeIn {
        0% { opacity: 0; }
        100% { opacity: 1; }
    }

    .loading {
        display: none;
        text-align: center;
        color: var(--color-primary); /* Biru neon */
        margin-top: 1rem;
    }

    .copy-btns {
        display: flex;
        justify-content: space-between;
        margin-top: 0.5rem;
    }

    .copy-btn {
        background: rgba(0, 212, 255, 0.2); /* Biru neon */
        color: var(--color-primary); /* Biru neon */
        padding: 0.5rem;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        transition: var(--transition);
        position: relative;
        overflow: hidden;
    }

    .copy-btn::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 300%;
        height: 300%;
        background: rgba(0, 255, 255, 0.3);
        transition: all 0.4s ease;
        border-radius: 50%;
        transform: translate(-50%, -50%) scale(0);
    }

    .copy-btn:hover::after {
        transform: translate(-50%, -50%) scale(1);
    }

    .copy-btn:hover {
        background: rgba(0, 212, 255, 0.3); /* Biru neon */
        box-shadow: 0 0 15px 8px rgba(0, 255, 255, 0.3); /* Glow saat hover */
    }

    #error-message {
        color: #ff4444;
        text-align: center;
        margin-top: 1rem;
    }
</style>



</head>
<body>
    <div class="container">
        <div class="card">
            <h1 class="title">Sub Link Generator</h1>
            <form id="subLinkForm">
                <div class="form-group">
                    <label for="app">Aplikasi</label>
                    <select id="app" class="form-control" required>
                        <option value="v2ray">V2RAY</option>
                        <option value="v2rayng">V2RAYNG</option>
                        <option value="clash">CLASH</option>
                        <option value="nekobox">NEKOBOX</option>
                        <option value="singbox">SINGBOX</option>
                        <option value="surfboard">SURFBOARD</option>
                    </select>
                </div>

                <div class="form-group">
                    <label for="bug">Bug</label>
                    <input type="text" id="bug" class="form-control" placeholder="Contoh: quiz.int.vidio.com" required>
                </div>

                <div class="form-group">
                    <label for="configType">Tipe Config</label>
                    <select id="configType" class="form-control" required>
                        <option value="vless">VLESS</option>
                        <option value="trojan">TROJAN</option>
                        <option value="shadowsocks">SHADOWSOCKS</option>
                    </select>
                </div>

                <div class="form-group">
                    <label for="tls">TLS</label>
                    <select id="tls" class="form-control">
                        <option value="true">TRUE</option>
                        <option value="false">FALSE</option>
                    </select>
                </div>

                <div class="form-group">
                    <label for="wildcard">Wildcard</label>
                    <select id="wildcard" class="form-control">
                        <option value="true">TRUE</option>
                        <option value="false">FALSE</option>
                    </select>
                </div>

                <div class="form-group">
                    <label for="country">Negara</label>
                    <select id="country" class="form-control">
                        <option value="all">ALL COUNTRY</option>
                        <option value="random">RANDOM</option>
                        <option value="id">INDONESIA</option>
                        <option value="sg">SINGAPURA</option>
                    </select>
                </div>

                <div class="form-group">
                    <label for="limit">Jumlah Config</label>
                    <input type="number" id="limit" class="form-control" min="1" max="20" placeholder="Maks 20" required>
                </div>

                <button type="submit" class="btn">Generate Sub Link</button>
            </form>

            <div id="loading" class="loading">Generating Link...</div>
            <div id="error-message"></div>

            <div id="result" class="result" style="display: none;">
                <p id="generated-link"></p>
                <div class="copy-btns">
                    <button id="copyLink" class="copy-btn">Copy Link</button>
                    <button id="openLink" class="copy-btn">Buka Link</button>
                </div>
            </div>
        </div>
    </div>

    <script>
        // Performance optimization: Use event delegation and minimize DOM queries
        document.addEventListener('DOMContentLoaded', () => {
            const form = document.getElementById('subLinkForm');
            const loadingEl = document.getElementById('loading');
            const resultEl = document.getElementById('result');
            const generatedLinkEl = document.getElementById('generated-link');
            const copyLinkBtn = document.getElementById('copyLink');
            const openLinkBtn = document.getElementById('openLink');
            const errorMessageEl = document.getElementById('error-message');
            const appSelect = document.getElementById('app');
            const configTypeSelect = document.getElementById('configType');

            // Cached selectors to minimize DOM lookups
            const elements = {
                app: document.getElementById('app'),
                bug: document.getElementById('bug'),
                configType: document.getElementById('configType'),
                tls: document.getElementById('tls'),
                wildcard: document.getElementById('wildcard'),
                country: document.getElementById('country'),
                limit: document.getElementById('limit')
            };

            // App and config type interaction
            appSelect.addEventListener('change', () => {
                const selectedApp = appSelect.value;
                const shadowsocksOption = configTypeSelect.querySelector('option[value="shadowsocks"]');
                
                if (selectedApp === 'surfboard') {
                    configTypeSelect.value = 'trojan';
                    configTypeSelect.querySelector('option[value="trojan"]').selected = true;
                    shadowsocksOption.disabled = true;
                } else {
                    shadowsocksOption.disabled = false;
                }
            });

            // Form submission handler
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                
                // Reset previous states
                loadingEl.style.display = 'block';
                resultEl.style.display = 'none';
                errorMessageEl.textContent = '';

                try {
                    // Validate inputs
                    const requiredFields = ['bug', 'limit'];
                    for (let field of requiredFields) {
                        if (!elements[field].value.trim()) {
                            throw new Error(\`Harap isi \${field === 'bug' ? 'Bug' : 'Jumlah Config'}\`);
                        }
                    }

                    // Construct query parameters
                    const params = new URLSearchParams({
                        type: elements.configType.value,
                        bug: elements.bug.value.trim(),
                        tls: elements.tls.value,
                        wildcard: elements.wildcard.value,
                        limit: elements.limit.value,
                        ...(elements.country.value !== 'all' && { country: elements.country.value })
                    });

                    // Generate full link (replace with your actual domain)
                    const generatedLink = \`/sub/\${elements.app.value}?\${params.toString()}\`;

                    // Simulate loading (remove in production)
                    await new Promise(resolve => setTimeout(resolve, 500));

                    // Update UI
                    loadingEl.style.display = 'none';
                    resultEl.style.display = 'block';
                    generatedLinkEl.textContent = \`https://\${window.location.hostname}\${generatedLink}\`;

                    // Copy link functionality
                    copyLinkBtn.onclick = async () => {
                        try {
                            await navigator.clipboard.writeText(\`https://\${window.location.hostname}\${generatedLink}\`);
                            alert('Link berhasil disalin!');
                        } catch {
                            alert('Gagal menyalin link.');
                        }
                    };

                    // Open link functionality
                    openLinkBtn.onclick = () => {
                        window.open(generatedLink, '_blank');
                    };

                } catch (error) {
                    // Error handling
                    loadingEl.style.display = 'none';
                    errorMessageEl.textContent = error.message;
                    console.error(error);
                }
            });
        });
    </script>
</body>
</html>
 `
return html
}

async function websockerHandler(request) {
  const webSocketPair = new WebSocketPair();
  const [client, webSocket] = Object.values(webSocketPair);

  webSocket.accept();

  let addressLog = "";
  let portLog = "";
  const log = (info, event) => {
    console.log(`[${addressLog}:${portLog}] ${info}`, event || "");
  };
  const earlyDataHeader = request.headers.get("sec-websocket-protocol") || "";

  const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader, log);

  let remoteSocketWrapper = {
    value: null,
  };
  let udpStreamWrite = null;
  let isDNS = false;

  readableWebSocketStream
    .pipeTo(
      new WritableStream({
        async write(chunk, controller) {
          if (isDNS && udpStreamWrite) {
            return udpStreamWrite(chunk);
          }
          if (remoteSocketWrapper.value) {
            const writer = remoteSocketWrapper.value.writable.getWriter();
            await writer.write(chunk);
            writer.releaseLock();
            return;
          }

          const protocol = await protocolSniffer(chunk);
          let protocolHeader;

          if (protocol === "Trojan") {
            protocolHeader = parseTrojanHeader(chunk);
          } else if (protocol === "VLESS") {
            protocolHeader = parseVlessHeader(chunk);
          } else if (protocol === "Shadowsocks") {
            protocolHeader = parseShadowsocksHeader(chunk);
          } else {
            parseVmessHeader(chunk);
            throw new Error("Unknown Protocol!");
          }

          addressLog = protocolHeader.addressRemote;
          portLog = `${protocolHeader.portRemote} -> ${protocolHeader.isUDP ? "UDP" : "TCP"}`;

          if (protocolHeader.hasError) {
            throw new Error(protocolHeader.message);
          }

          if (protocolHeader.isUDP) {
            if (protocolHeader.portRemote === 53) {
              isDNS = true;
            } else {
              throw new Error("UDP only support for DNS port 53");
            }
          }

          if (isDNS) {
            const { write } = await handleUDPOutbound(webSocket, protocolHeader.version, log);
            udpStreamWrite = write;
            udpStreamWrite(protocolHeader.rawClientData);
            return;
          }

          handleTCPOutBound(
            remoteSocketWrapper,
            protocolHeader.addressRemote,
            protocolHeader.portRemote,
            protocolHeader.rawClientData,
            webSocket,
            protocolHeader.version,
            log
          );
        },
        close() {
          log(`readableWebSocketStream is close`);
        },
        abort(reason) {
          log(`readableWebSocketStream is abort`, JSON.stringify(reason));
        },
      })
    )
    .catch((err) => {
      log("readableWebSocketStream pipeTo error", err);
    });

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}

async function protocolSniffer(buffer) {
  if (buffer.byteLength >= 62) {
    const trojanDelimiter = new Uint8Array(buffer.slice(56, 60));
    if (trojanDelimiter[0] === 0x0d && trojanDelimiter[1] === 0x0a) {
      if (trojanDelimiter[2] === 0x01 || trojanDelimiter[2] === 0x03 || trojanDelimiter[2] === 0x7f) {
        if (trojanDelimiter[3] === 0x01 || trojanDelimiter[3] === 0x03 || trojanDelimiter[3] === 0x04) {
          return "Trojan";
        }
      }
    }
  }

  const vlessDelimiter = new Uint8Array(buffer.slice(1, 17));
  // Hanya mendukung UUID v4
  if (arrayBufferToHex(vlessDelimiter).match(/^\w{8}\w{4}4\w{3}[89ab]\w{3}\w{12}$/)) {
    return "VLESS";
  }

  return "Shadowsocks"; // default
}

async function handleTCPOutBound(
  remoteSocket,
  addressRemote,
  portRemote,
  rawClientData,
  webSocket,
  responseHeader,
  log
) {
  async function connectAndWrite(address, port) {
    const tcpSocket = connect({
      hostname: address,
      port: port,
    });
    remoteSocket.value = tcpSocket;
    log(`connected to ${address}:${port}`);
    const writer = tcpSocket.writable.getWriter();
    await writer.write(rawClientData);
    writer.releaseLock();
    return tcpSocket;
  }

  async function retry() {
    const tcpSocket = await connectAndWrite(
      proxyIP.split(/[:=-]/)[0] || addressRemote,
      proxyIP.split(/[:=-]/)[1] || portRemote
    );
    tcpSocket.closed
      .catch((error) => {
        console.log("retry tcpSocket closed error", error);
      })
      .finally(() => {
        safeCloseWebSocket(webSocket);
      });
    remoteSocketToWS(tcpSocket, webSocket, responseHeader, null, log);
  }

  const tcpSocket = await connectAndWrite(addressRemote, portRemote);

  remoteSocketToWS(tcpSocket, webSocket, responseHeader, retry, log);
}

function makeReadableWebSocketStream(webSocketServer, earlyDataHeader, log) {
  let readableStreamCancel = false;
  const stream = new ReadableStream({
    start(controller) {
      webSocketServer.addEventListener("message", (event) => {
        if (readableStreamCancel) {
          return;
        }
        const message = event.data;
        controller.enqueue(message);
      });
      webSocketServer.addEventListener("close", () => {
        safeCloseWebSocket(webSocketServer);
        if (readableStreamCancel) {
          return;
        }
        controller.close();
      });
      webSocketServer.addEventListener("error", (err) => {
        log("webSocketServer has error");
        controller.error(err);
      });
      const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
      if (error) {
        controller.error(error);
      } else if (earlyData) {
        controller.enqueue(earlyData);
      }
    },

    pull(controller) {},
    cancel(reason) {
      if (readableStreamCancel) {
        return;
      }
      log(`ReadableStream was canceled, due to ${reason}`);
      readableStreamCancel = true;
      safeCloseWebSocket(webSocketServer);
    },
  });

  return stream;
}

function parseVmessHeader(vmessBuffer) {
  // https://xtls.github.io/development/protocols/vmess.html#%E6%8C%87%E4%BB%A4%E9%83%A8%E5%88%86
}

function parseShadowsocksHeader(ssBuffer) {
  const view = new DataView(ssBuffer);

  const addressType = view.getUint8(0);
  let addressLength = 0;
  let addressValueIndex = 1;
  let addressValue = "";

  switch (addressType) {
    case 1:
      addressLength = 4;
      addressValue = new Uint8Array(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(".");
      break;
    case 3:
      addressLength = new Uint8Array(ssBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
      addressValueIndex += 1;
      addressValue = new TextDecoder().decode(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      break;
    case 4:
      addressLength = 16;
      const dataView = new DataView(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16));
      }
      addressValue = ipv6.join(":");
      break;
    default:
      return {
        hasError: true,
        message: `Invalid addressType for Shadowsocks: ${addressType}`,
      };
  }

  if (!addressValue) {
    return {
      hasError: true,
      message: `Destination address empty, address type is: ${addressType}`,
    };
  }

  const portIndex = addressValueIndex + addressLength;
  const portBuffer = ssBuffer.slice(portIndex, portIndex + 2);
  const portRemote = new DataView(portBuffer).getUint16(0);
  return {
    hasError: false,
    addressRemote: addressValue,
    addressType: addressType,
    portRemote: portRemote,
    rawDataIndex: portIndex + 2,
    rawClientData: ssBuffer.slice(portIndex + 2),
    version: null,
    isUDP: portRemote == 53,
  };
}

function parseVlessHeader(vlessBuffer) {
  const version = new Uint8Array(vlessBuffer.slice(0, 1));
  let isUDP = false;

  const optLength = new Uint8Array(vlessBuffer.slice(17, 18))[0];

  const cmd = new Uint8Array(vlessBuffer.slice(18 + optLength, 18 + optLength + 1))[0];
  if (cmd === 1) {
  } else if (cmd === 2) {
    isUDP = true;
  } else {
    return {
      hasError: true,
      message: `command ${cmd} is not support, command 01-tcp,02-udp,03-mux`,
    };
  }
  const portIndex = 18 + optLength + 1;
  const portBuffer = vlessBuffer.slice(portIndex, portIndex + 2);
  const portRemote = new DataView(portBuffer).getUint16(0);

  let addressIndex = portIndex + 2;
  const addressBuffer = new Uint8Array(vlessBuffer.slice(addressIndex, addressIndex + 1));

  const addressType = addressBuffer[0];
  let addressLength = 0;
  let addressValueIndex = addressIndex + 1;
  let addressValue = "";
  switch (addressType) {
    case 1: // For IPv4
      addressLength = 4;
      addressValue = new Uint8Array(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(".");
      break;
    case 2: // For Domain
      addressLength = new Uint8Array(vlessBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
      addressValueIndex += 1;
      addressValue = new TextDecoder().decode(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      break;
    case 3: // For IPv6
      addressLength = 16;
      const dataView = new DataView(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16));
      }
      addressValue = ipv6.join(":");
      break;
    default:
      return {
        hasError: true,
        message: `invild  addressType is ${addressType}`,
      };
  }
  if (!addressValue) {
    return {
      hasError: true,
      message: `addressValue is empty, addressType is ${addressType}`,
    };
  }

  return {
    hasError: false,
    addressRemote: addressValue,
    addressType: addressType,
    portRemote: portRemote,
    rawDataIndex: addressValueIndex + addressLength,
    rawClientData: vlessBuffer.slice(addressValueIndex + addressLength),
    version: new Uint8Array([version[0], 0]),
    isUDP: isUDP,
  };
}

function parseTrojanHeader(buffer) {
  const socks5DataBuffer = buffer.slice(58);
  if (socks5DataBuffer.byteLength < 6) {
    return {
      hasError: true,
      message: "invalid SOCKS5 request data",
    };
  }

  let isUDP = false;
  const view = new DataView(socks5DataBuffer);
  const cmd = view.getUint8(0);
  if (cmd == 3) {
    isUDP = true;
  } else if (cmd != 1) {
    throw new Error("Unsupported command type!");
  }

  let addressType = view.getUint8(1);
  let addressLength = 0;
  let addressValueIndex = 2;
  let addressValue = "";
  switch (addressType) {
    case 1: // For IPv4
      addressLength = 4;
      addressValue = new Uint8Array(socks5DataBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(
        "."
      );
      break;
    case 3: // For Domain
      addressLength = new Uint8Array(socks5DataBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
      addressValueIndex += 1;
      addressValue = new TextDecoder().decode(
        socks5DataBuffer.slice(addressValueIndex, addressValueIndex + addressLength)
      );
      break;
    case 4: // For IPv6
      addressLength = 16;
      const dataView = new DataView(socks5DataBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16));
      }
      addressValue = ipv6.join(":");
      break;
    default:
      return {
        hasError: true,
        message: `invalid addressType is ${addressType}`,
      };
  }

  if (!addressValue) {
    return {
      hasError: true,
      message: `address is empty, addressType is ${addressType}`,
    };
  }

  const portIndex = addressValueIndex + addressLength;
  const portBuffer = socks5DataBuffer.slice(portIndex, portIndex + 2);
  const portRemote = new DataView(portBuffer).getUint16(0);
  return {
    hasError: false,
    addressRemote: addressValue,
    addressType: addressType,
    portRemote: portRemote,
    rawDataIndex: portIndex + 4,
    rawClientData: socks5DataBuffer.slice(portIndex + 4),
    version: null,
    isUDP: isUDP,
  };
}

async function remoteSocketToWS(remoteSocket, webSocket, responseHeader, retry, log) {
  let header = responseHeader;
  let hasIncomingData = false;
  await remoteSocket.readable
    .pipeTo(
      new WritableStream({
        start() {},
        async write(chunk, controller) {
          hasIncomingData = true;
          if (webSocket.readyState !== WS_READY_STATE_OPEN) {
            controller.error("webSocket.readyState is not open, maybe close");
          }
          if (header) {
            webSocket.send(await new Blob([header, chunk]).arrayBuffer());
            header = null;
          } else {
            webSocket.send(chunk);
          }
        },
        close() {
          log(`remoteConnection!.readable is close with hasIncomingData is ${hasIncomingData}`);
        },
        abort(reason) {
          console.error(`remoteConnection!.readable abort`, reason);
        },
      })
    )
    .catch((error) => {
      console.error(`remoteSocketToWS has exception `, error.stack || error);
      safeCloseWebSocket(webSocket);
    });
  if (hasIncomingData === false && retry) {
    log(`retry`);
    retry();
  }
}

function base64ToArrayBuffer(base64Str) {
  if (!base64Str) {
    return { error: null };
  }
  try {
    base64Str = base64Str.replace(/-/g, "+").replace(/_/g, "/");
    const decode = atob(base64Str);
    const arryBuffer = Uint8Array.from(decode, (c) => c.charCodeAt(0));
    return { earlyData: arryBuffer.buffer, error: null };
  } catch (error) {
    return { error };
  }
}

function arrayBufferToHex(buffer) {
  return [...new Uint8Array(buffer)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function handleUDPOutbound(webSocket, responseHeader, log) {
  let isVlessHeaderSent = false;
  const transformStream = new TransformStream({
    start(controller) {},
    transform(chunk, controller) {
      for (let index = 0; index < chunk.byteLength; ) {
        const lengthBuffer = chunk.slice(index, index + 2);
        const udpPakcetLength = new DataView(lengthBuffer).getUint16(0);
        const udpData = new Uint8Array(chunk.slice(index + 2, index + 2 + udpPakcetLength));
        index = index + 2 + udpPakcetLength;
        controller.enqueue(udpData);
      }
    },
    flush(controller) {},
  });
  transformStream.readable
    .pipeTo(
      new WritableStream({
        async write(chunk) {
          const resp = await fetch("https://1.1.1.1/dns-query", {
            method: "POST",
            headers: {
              "content-type": "application/dns-message",
            },
            body: chunk,
          });
          const dnsQueryResult = await resp.arrayBuffer();
          const udpSize = dnsQueryResult.byteLength;
          const udpSizeBuffer = new Uint8Array([(udpSize >> 8) & 0xff, udpSize & 0xff]);
          if (webSocket.readyState === WS_READY_STATE_OPEN) {
            log(`doh success and dns message length is ${udpSize}`);
            if (isVlessHeaderSent) {
              webSocket.send(await new Blob([udpSizeBuffer, dnsQueryResult]).arrayBuffer());
            } else {
              webSocket.send(await new Blob([responseHeader, udpSizeBuffer, dnsQueryResult]).arrayBuffer());
              isVlessHeaderSent = true;
            }
          }
        },
      })
    )
    .catch((error) => {
      log("dns udp has error" + error);
    });

  const writer = transformStream.writable.getWriter();

  return {
    write(chunk) {
      writer.write(chunk);
    },
  };
}

function safeCloseWebSocket(socket) {
  try {
    if (socket.readyState === WS_READY_STATE_OPEN || socket.readyState === WS_READY_STATE_CLOSING) {
      socket.close();
    }
  } catch (error) {
    console.error("safeCloseWebSocket error", error);
  }
}
// Fungsi untuk mengonversi countryCode menjadi emoji bendera
const getEmojiFlag = (countryCode) => {
  if (!countryCode || countryCode.length !== 2) return ''; // Validasi input
  return String.fromCodePoint(
    ...[...countryCode.toUpperCase()].map(char => 0x1F1E6 + char.charCodeAt(0) - 65)
  );
};
async function generateClashSub(type, bug, inconigtomode, tls, country = null, limit = null) {
  const proxyListResponse = await fetch(DEFAULT_PROXY_BANK_URL);
  const proxyList = await proxyListResponse.text();
  let ips = proxyList
    .split('\n')
    .filter(Boolean)
  if (country && country.toLowerCase() === 'random') {
    // Pilih data secara acak jika country=random
    ips = ips.sort(() => Math.random() - 0.5); // Acak daftar proxy
  } else if (country) {
    // Filter berdasarkan country jika bukan "random"
    ips = ips.filter(line => {
      const parts = line.split(',');
      if (parts.length > 1) {
        const lineCountry = parts[2].toUpperCase();
        return lineCountry === country.toUpperCase();
      }
      return false;
    });
  }
  
  if (limit && !isNaN(limit)) {
    ips = ips.slice(0, limit); // Batasi jumlah proxy berdasarkan limit
  }
  
  let conf = '';
  let bex = '';
  let count = 1;
  
  for (let line of ips) {
    const parts = line.split(',');
    const proxyHost = parts[0];
    const proxyPort = parts[1] || 443;
    const emojiFlag = getEmojiFlag(line.split(',')[2]); // Konversi ke emoji bendera
    const sanitize = (text) => text.replace(/[\n\r]+/g, "").trim(); // Hapus newline dan spasi ekstra
    let ispName = sanitize(`${emojiFlag} (${line.split(',')[2]}) ${line.split(',')[3]} ${count ++}`);
    const UUIDS = `${generateUUIDv4()}`;
    const ports = tls ? '443' : '80';
    const snio = tls ? `\n  servername: ${inconigtomode}` : '';
    const snioo = tls ? `\n  cipher: auto` : '';
    if (type === 'vless') {
      bex += `  - ${ispName}\n`
      conf += `
- name: ${ispName}
  server: ${bug}
  port: ${ports}
  type: vless
  uuid: ${UUIDS}${snioo}
  tls: ${tls}
  udp: true
  skip-cert-verify: true
  client-fingerprint: chrome
  network: ws${snio}
  alpn:
    - h2
    - h3
    - http/1.1
  ws-opts:
    path: /${proxyHost}=${proxyPort}
    headers:
      Host: ${inconigtomode}
    max-early-data: 0
    early-data-header-name: Sec-WebSocket-Protocol
    ip-version: dual
    v2ray-http-upgrade: false
    v2ray-http-upgrade-fast-open: false
    `;
    } else if (type === 'trojan') {
      bex += `  - ${ispName}\n`
      conf += `
- name: ${ispName}
  server: ${bug}
  port: 443
  type: trojan
  password: ${UUIDS}
  tls: true
  client-fingerprint: chrome
  udp: true
  skip-cert-verify: true
  network: ws
  sni: ${inconigtomode}
  alpn:
    - h2
    - h3
    - http/1.1
  ws-opts:
    path: /${proxyHost}=${proxyPort}
    headers:
      Host: ${inconigtomode}
    max-early-data: 0
    early-data-header-name: Sec-WebSocket-Protocol
    ip-version: dual
    v2ray-http-upgrade: false
    v2ray-http-upgrade-fast-open: false
    `;
    } else if (type === 'shadowsocks') {
      bex += `  - ${ispName}\n`
      conf += `
- name: ${ispName}
  type: ss
  server: ${bug}
  port: ${ports}
  cipher: none
  password: ${UUIDS}
  udp: true
  plugin: v2ray-plugin
  client-fingerprint: chrome
  plugin-opts:
    mode: websocket
    tls: ${tls}
    skip-cert-verify: true
    host: ${inconigtomode}
    path: /${proxyHost}=${proxyPort}
    mux: false
  headers:
    custom: value
    ip-version: dual
    v2ray-http-upgrade: false
    v2ray-http-upgrade-fast-open: false
    `;
    } else if (type === 'mix') {
      bex += `  - ${ispName} vless\n  - ${ispName} trojan\n  - ${ispName} ss\n`;
      conf += `
- name: ${ispName} vless
  server: ${bug}
  port: ${ports}
  type: vless
  uuid: ${UUIDS}
  cipher: auto
  tls: ${tls}
  udp: true
  skip-cert-verify: true
  network: ws${snio}
  ws-opts:
    path: /${proxyHost}=${proxyPort}
    headers:
      Host: ${inconigtomode}
- name: ${ispName} trojan
  server: ${bug}
  port: 443
  type: trojan
  password: ${UUIDS}
  udp: true
  skip-cert-verify: true
  network: ws
  sni: ${inconigtomode}
  ws-opts:
    path: /${proxyHost}=${proxyPort}
    headers:
      Host: ${inconigtomode}
- name: ${ispName} ss
  type: ss
  server: ${bug}
  port: ${ports}
  cipher: none
  password: ${UUIDS}
  udp: true
  plugin: v2ray-plugin
  plugin-opts:
    mode: websocket
    tls: ${tls}
    skip-cert-verify: true
    host: ${inconigtomode}
    path: /${proxyHost}=${proxyPort}
    mux: false
    headers:
      custom: ${inconigtomode}`;
    }
  }
  return `
proxies:
${conf}`;
}
async function generateSurfboardSub(type, bug, inconigtomode, tls, country = null, limit = null) {
  const proxyListResponse = await fetch(DEFAULT_PROXY_BANK_URL);
  const proxyList = await proxyListResponse.text();
  let ips = proxyList
    .split('\n')
    .filter(Boolean)
  if (country && country.toLowerCase() === 'random') {
    // Pilih data secara acak jika country=random
    ips = ips.sort(() => Math.random() - 0.5); // Acak daftar proxy
  } else if (country) {
    // Filter berdasarkan country jika bukan "random"
    ips = ips.filter(line => {
      const parts = line.split(',');
      if (parts.length > 1) {
        const lineCountry = parts[2].toUpperCase();
        return lineCountry === country.toUpperCase();
      }
      return false;
    });
  }
  if (limit && !isNaN(limit)) {
    ips = ips.slice(0, limit); // Batasi jumlah proxy berdasarkan limit
  }
  let conf = '';
  let bex = '';
  let count = 1;
  
  for (let line of ips) {
    const parts = line.split(',');
    const proxyHost = parts[0];
    const proxyPort = parts[1] || 443;
    const emojiFlag = getEmojiFlag(line.split(',')[2]); // Konversi ke emoji bendera
    const sanitize = (text) => text.replace(/[\n\r]+/g, "").trim(); // Hapus newline dan spasi ekstra
    let ispName = sanitize(`${emojiFlag} (${line.split(',')[2]}) ${line.split(',')[3]} ${count ++}`);
    const UUIDS = `${generateUUIDv4()}`;
    if (type === 'trojan') {
      bex += `${ispName},`
      conf += `
${ispName} = trojan, ${bug}, 443, password = ${UUIDS}, udp-relay = true, skip-cert-verify = true, sni = ${inconigtomode}, ws = true, ws-path = /${proxyHost}:${proxyPort}, ws-headers = Host:"${inconigtomode}"\n`;
    }
  }
  return `


[General]
dns-server = system, 108.137.44.39, 108.137.44.9, puredns.org:853

[Proxy]
${conf}

[Proxy Group]
Select Group = select,Load Balance,Best Ping,FallbackGroup,${bex}
Load Balance = load-balance,${bex}
Best Ping = url-test,${bex} url=http://www.gstatic.com/generate_204, interval=600, tolerance=100, timeout=5
FallbackGroup = fallback,${bex} url=http://www.gstatic.com/generate_204, interval=600, timeout=5
AdBlock = select,REJECT,Select Group

[Rule]
MATCH,Select Group
DOMAIN-SUFFIX,pagead2.googlesyndication.com, AdBlock
DOMAIN-SUFFIX,pagead2.googleadservices.com, AdBlock
DOMAIN-SUFFIX,afs.googlesyndication.com, AdBlock
DOMAIN-SUFFIX,ads.google.com, AdBlock
DOMAIN-SUFFIX,adservice.google.com, AdBlock
DOMAIN-SUFFIX,googleadservices.com, AdBlock
DOMAIN-SUFFIX,static.media.net, AdBlock
DOMAIN-SUFFIX,media.net, AdBlock
DOMAIN-SUFFIX,adservetx.media.net, AdBlock
DOMAIN-SUFFIX,mediavisor.doubleclick.net, AdBlock
DOMAIN-SUFFIX,m.doubleclick.net, AdBlock
DOMAIN-SUFFIX,static.doubleclick.net, AdBlock
DOMAIN-SUFFIX,doubleclick.net, AdBlock
DOMAIN-SUFFIX,ad.doubleclick.net, AdBlock
DOMAIN-SUFFIX,fastclick.com, AdBlock
DOMAIN-SUFFIX,fastclick.net, AdBlock
DOMAIN-SUFFIX,media.fastclick.net, AdBlock
DOMAIN-SUFFIX,cdn.fastclick.net, AdBlock
DOMAIN-SUFFIX,adtago.s3.amazonaws.com, AdBlock
DOMAIN-SUFFIX,analyticsengine.s3.amazonaws.com, AdBlock
DOMAIN-SUFFIX,advice-ads.s3.amazonaws.com, AdBlock
DOMAIN-SUFFIX,affiliationjs.s3.amazonaws.com, AdBlock
DOMAIN-SUFFIX,advertising-api-eu.amazon.com, AdBlock
DOMAIN-SUFFIX,amazonclix.com, AdBlock, AdBlock
DOMAIN-SUFFIX,assoc-amazon.com, AdBlock
DOMAIN-SUFFIX,ads.yahoo.com, AdBlock
DOMAIN-SUFFIX,adserver.yahoo.com, AdBlock
DOMAIN-SUFFIX,global.adserver.yahoo.com, AdBlock
DOMAIN-SUFFIX,us.adserver.yahoo.com, AdBlock
DOMAIN-SUFFIX,adspecs.yahoo.com, AdBlock
DOMAIN-SUFFIX,br.adspecs.yahoo.com, AdBlock
DOMAIN-SUFFIX,latam.adspecs.yahoo.com, AdBlock
DOMAIN-SUFFIX,ush.adspecs.yahoo.com, AdBlock
DOMAIN-SUFFIX,advertising.yahoo.com, AdBlock
DOMAIN-SUFFIX,de.advertising.yahoo.com, AdBlock
DOMAIN-SUFFIX,es.advertising.yahoo.com, AdBlock
DOMAIN-SUFFIX,fr.advertising.yahoo.com, AdBlock
DOMAIN-SUFFIX,in.advertising.yahoo.com, AdBlock
DOMAIN-SUFFIX,it.advertising.yahoo.com, AdBlock
DOMAIN-SUFFIX,sea.advertising.yahoo.com, AdBlock
DOMAIN-SUFFIX,uk.advertising.yahoo.com, AdBlock
DOMAIN-SUFFIX,analytics.yahoo.com, AdBlock
DOMAIN-SUFFIX,cms.analytics.yahoo.com, AdBlock
DOMAIN-SUFFIX,opus.analytics.yahoo.com, AdBlock
DOMAIN-SUFFIX,sp.analytics.yahoo.com, AdBlock
DOMAIN-SUFFIX,comet.yahoo.com, AdBlock
DOMAIN-SUFFIX,log.fc.yahoo.com, AdBlock
DOMAIN-SUFFIX,ganon.yahoo.com, AdBlock
DOMAIN-SUFFIX,gemini.yahoo.com, AdBlock
DOMAIN-SUFFIX,beap.gemini.yahoo.com, AdBlock
DOMAIN-SUFFIX,geo.yahoo.com, AdBlock
DOMAIN-SUFFIX,marketingsolutions.yahoo.com, AdBlock
DOMAIN-SUFFIX,pclick.yahoo.com, AdBlock
DOMAIN-SUFFIX,analytics.query.yahoo.com, AdBlock
DOMAIN-SUFFIX,geo.query.yahoo.com, AdBlock
DOMAIN-SUFFIX,onepush.query.yahoo.com, AdBlock
DOMAIN-SUFFIX,bats.video.yahoo.com, AdBlock
DOMAIN-SUFFIX,visit.webhosting.yahoo.com, AdBlock
DOMAIN-SUFFIX,ads.yap.yahoo.com, AdBlock
DOMAIN-SUFFIX,m.yap.yahoo.com, AdBlock
DOMAIN-SUFFIX,partnerads.ysm.yahoo.com, AdBlock
DOMAIN-SUFFIX,appmetrica.yandex.com, AdBlock
DOMAIN-SUFFIX,redirect.appmetrica.yandex.com, AdBlock
DOMAIN-SUFFIX,19534.redirect.appmetrica.yandex.com, AdBlock
DOMAIN-SUFFIX,3.redirect.appmetrica.yandex.com, AdBlock
DOMAIN-SUFFIX,30488.redirect.appmetrica.yandex.com, AdBlock
DOMAIN-SUFFIX,4.redirect.appmetrica.yandex.com, AdBlock
DOMAIN-SUFFIX,report.appmetrica.yandex.net, AdBlock
DOMAIN-SUFFIX,extmaps-api.yandex.net, AdBlock
DOMAIN-SUFFIX,analytics.mobile.yandex.net, AdBlock
DOMAIN-SUFFIX,banners.mobile.yandex.net, AdBlock
DOMAIN-SUFFIX,banners-slb.mobile.yandex.net, AdBlock
DOMAIN-SUFFIX,startup.mobile.yandex.net, AdBlock
DOMAIN-SUFFIX,offerwall.yandex.net, AdBlock
DOMAIN-SUFFIX,adfox.yandex.ru, AdBlock
DOMAIN-SUFFIX,matchid.adfox.yandex.ru, AdBlock
DOMAIN-SUFFIX,adsdk.yandex.ru, AdBlock
DOMAIN-SUFFIX,an.yandex.ru, AdBlock
DOMAIN-SUFFIX,redirect.appmetrica.yandex.ru, AdBlock
DOMAIN-SUFFIX,awaps.yandex.ru, AdBlock
DOMAIN-SUFFIX,awsync.yandex.ru, AdBlock
DOMAIN-SUFFIX,bs.yandex.ru, AdBlock
DOMAIN-SUFFIX,bs-meta.yandex.ru, AdBlock
DOMAIN-SUFFIX,clck.yandex.ru, AdBlock
DOMAIN-SUFFIX,informer.yandex.ru, AdBlock
DOMAIN-SUFFIX,kiks.yandex.ru, AdBlock
DOMAIN-SUFFIX,grade.market.yandex.ru, AdBlock
DOMAIN-SUFFIX,mc.yandex.ru, AdBlock
DOMAIN-SUFFIX,metrika.yandex.ru, AdBlock
DOMAIN-SUFFIX,click.sender.yandex.ru, AdBlock
DOMAIN-SUFFIX,share.yandex.ru, AdBlock
DOMAIN-SUFFIX,yandexadexchange.net, AdBlock
DOMAIN-SUFFIX,mobile.yandexadexchange.net, AdBlock
DOMAIN-SUFFIX,google-analytics.com, AdBlock
DOMAIN-SUFFIX,ssl.google-analytics.com, AdBlock
DOMAIN-SUFFIX,api-hotjar.com, AdBlock
DOMAIN-SUFFIX,hotjar-analytics.com, AdBlock
DOMAIN-SUFFIX,hotjar.com, AdBlock
DOMAIN-SUFFIX,static.hotjar.com, AdBlock
DOMAIN-SUFFIX,mouseflow.com, AdBlock
DOMAIN-SUFFIX,a.mouseflow.com, AdBlock
DOMAIN-SUFFIX,freshmarketer.com, AdBlock
DOMAIN-SUFFIX,luckyorange.com, AdBlock
DOMAIN-SUFFIX,luckyorange.net, AdBlock
DOMAIN-SUFFIX,cdn.luckyorange.com, AdBlock
DOMAIN-SUFFIX,w1.luckyorange.com, AdBlock
DOMAIN-SUFFIX,upload.luckyorange.net, AdBlock
DOMAIN-SUFFIX,cs.luckyorange.net, AdBlock
DOMAIN-SUFFIX,settings.luckyorange.net, AdBlock
DOMAIN-SUFFIX,stats.wp.com, AdBlock
DOMAIN-SUFFIX,notify.bugsnag.com, AdBlock
DOMAIN-SUFFIX,sessions.bugsnag.com, AdBlock
DOMAIN-SUFFIX,api.bugsnag.com, AdBlock
DOMAIN-SUFFIX,app.bugsnag.com, AdBlock
DOMAIN-SUFFIX,browser.sentry-cdn.com, AdBlock
DOMAIN-SUFFIX,app.getsentry.com, AdBlock
DOMAIN-SUFFIX,pixel.facebook.com, AdBlock
DOMAIN-SUFFIX,analytics.facebook.com, AdBlock
DOMAIN-SUFFIX,ads.facebook.com, AdBlock
DOMAIN-SUFFIX,an.facebook.com, AdBlock
DOMAIN-SUFFIX,ads-api.twitter.com, AdBlock
DOMAIN-SUFFIX,advertising.twitter.com, AdBlock
DOMAIN-SUFFIX,ads-twitter.com, AdBlock
DOMAIN-SUFFIX,static.ads-twitter.com, AdBlock
DOMAIN-SUFFIX,ads.linkedin.com, AdBlock
DOMAIN-SUFFIX,analytics.pointdrive.linkedin.com, AdBlock
DOMAIN-SUFFIX,ads.pinterest.com, AdBlock
DOMAIN-SUFFIX,log.pinterest.com, AdBlock
DOMAIN-SUFFIX,ads-dev.pinterest.com, AdBlock
DOMAIN-SUFFIX,analytics.pinterest.com, AdBlock
DOMAIN-SUFFIX,trk.pinterest.com, AdBlock
DOMAIN-SUFFIX,trk2.pinterest.com, AdBlock
DOMAIN-SUFFIX,widgets.pinterest.com, AdBlock
DOMAIN-SUFFIX,ads.reddit.com, AdBlock
DOMAIN-SUFFIX,rereddit.com, AdBlock
DOMAIN-SUFFIX,events.redditmedia.com, AdBlock
DOMAIN-SUFFIX,d.reddit.com, AdBlock
DOMAIN-SUFFIX,ads-sg.tiktok.com, AdBlock
DOMAIN-SUFFIX,analytics-sg.tiktok.com, AdBlock
DOMAIN-SUFFIX,ads.tiktok.com, AdBlock
DOMAIN-SUFFIX,analytics.tiktok.com, AdBlock
DOMAIN-SUFFIX,ads.youtube.com, AdBlock
DOMAIN-SUFFIX,youtube.cleverads.vn, AdBlock
DOMAIN-SUFFIX,ads.yahoo.com, AdBlock
DOMAIN-SUFFIX,adserver.yahoo.com, AdBlock
DOMAIN-SUFFIX,global.adserver.yahoo.com, AdBlock
DOMAIN-SUFFIX,us.adserver.yahoo.com, AdBlock
DOMAIN-SUFFIX,adspecs.yahoo.com, AdBlock
DOMAIN-SUFFIX,advertising.yahoo.com, AdBlock
DOMAIN-SUFFIX,analytics.yahoo.com, AdBlock
DOMAIN-SUFFIX,analytics.query.yahoo.com, AdBlock
DOMAIN-SUFFIX,ads.yap.yahoo.com, AdBlock
DOMAIN-SUFFIX,m.yap.yahoo.com, AdBlock
DOMAIN-SUFFIX,partnerads.ysm.yahoo.com, AdBlock
DOMAIN-SUFFIX,appmetrica.yandex.com, AdBlock
DOMAIN-SUFFIX,redirect.appmetrica.yandex.com, AdBlock
DOMAIN-SUFFIX,19534.redirect.appmetrica.yandex.com, AdBlock
DOMAIN-SUFFIX,3.redirect.appmetrica.yandex.com, AdBlock
DOMAIN-SUFFIX,30488.redirect.appmetrica.yandex.com, AdBlock
DOMAIN-SUFFIX,4.redirect.appmetrica.yandex.com, AdBlock
DOMAIN-SUFFIX,report.appmetrica.yandex.net, AdBlock
DOMAIN-SUFFIX,extmaps-api.yandex.net, AdBlock
DOMAIN-SUFFIX,analytics.mobile.yandex.net, AdBlock
DOMAIN-SUFFIX,banners.mobile.yandex.net, AdBlock
DOMAIN-SUFFIX,banners-slb.mobile.yandex.net, AdBlock
DOMAIN-SUFFIX,startup.mobile.yandex.net, AdBlock
DOMAIN-SUFFIX,offerwall.yandex.net, AdBlock
DOMAIN-SUFFIX,adfox.yandex.ru, AdBlock
DOMAIN-SUFFIX,matchid.adfox.yandex.ru, AdBlock
DOMAIN-SUFFIX,adsdk.yandex.ru, AdBlock
DOMAIN-SUFFIX,an.yandex.ru, AdBlock
DOMAIN-SUFFIX,redirect.appmetrica.yandex.ru, AdBlock
DOMAIN-SUFFIX,awaps.yandex.ru, AdBlock
DOMAIN-SUFFIX,awsync.yandex.ru, AdBlock
DOMAIN-SUFFIX,bs.yandex.ru, AdBlock
DOMAIN-SUFFIX,bs-meta.yandex.ru, AdBlock
DOMAIN-SUFFIX,clck.yandex.ru, AdBlock
DOMAIN-SUFFIX,informer.yandex.ru, AdBlock
DOMAIN-SUFFIX,kiks.yandex.ru, AdBlock
DOMAIN-SUFFIX,grade.market.yandex.ru, AdBlock
DOMAIN-SUFFIX,mc.yandex.ru, AdBlock
DOMAIN-SUFFIX,metrika.yandex.ru, AdBlock
DOMAIN-SUFFIX,click.sender.yandex.ru, AdBlock
DOMAIN-SUFFIX,share.yandex.ru, AdBlock
DOMAIN-SUFFIX,yandexadexchange.net, AdBlock
DOMAIN-SUFFIX,mobile.yandexadexchange.net, AdBlock
DOMAIN-SUFFIX,bdapi-in-ads.realmemobile.com, AdBlock
DOMAIN-SUFFIX,adsfs.oppomobile.com, AdBlock
DOMAIN-SUFFIX,adx.ads.oppomobile.com, AdBlock
DOMAIN-SUFFIX,bdapi.ads.oppomobile.com, AdBlock
DOMAIN-SUFFIX,ck.ads.oppomobile.com, AdBlock
DOMAIN-SUFFIX,data.ads.oppomobile.com, AdBlock
DOMAIN-SUFFIX,g1.ads.oppomobile.com, AdBlock
DOMAIN-SUFFIX,api.ad.xiaomi.com, AdBlock
DOMAIN-SUFFIX,app.chat.xiaomi.net, AdBlock
DOMAIN-SUFFIX,data.mistat.xiaomi.com, AdBlock
DOMAIN-SUFFIX,data.mistat.intl.xiaomi.com, AdBlock
DOMAIN-SUFFIX,data.mistat.india.xiaomi.com, AdBlock
DOMAIN-SUFFIX,data.mistat.rus.xiaomi.com, AdBlock
DOMAIN-SUFFIX,sdkconfig.ad.xiaomi.com, AdBlock
DOMAIN-SUFFIX,sdkconfig.ad.intl.xiaomi.com, AdBlock
DOMAIN-SUFFIX,globalapi.ad.xiaomi.com, AdBlock
DOMAIN-SUFFIX,www.cdn.ad.xiaomi.com, AdBlock
DOMAIN-SUFFIX,tracking.miui.com, AdBlock
DOMAIN-SUFFIX,sa.api.intl.miui.com, AdBlock
DOMAIN-SUFFIX,tracking.miui.com, AdBlock
DOMAIN-SUFFIX,tracking.intl.miui.com, AdBlock
DOMAIN-SUFFIX,tracking.india.miui.com, AdBlock
DOMAIN-SUFFIX,tracking.rus.miui.com, AdBlock
DOMAIN-SUFFIX,analytics.oneplus.cn, AdBlock
DOMAIN-SUFFIX,click.oneplus.cn, AdBlock
DOMAIN-SUFFIX,click.oneplus.com, AdBlock
DOMAIN-SUFFIX,open.oneplus.net, AdBlock
DOMAIN-SUFFIX,metrics.data.hicloud.com, AdBlock
DOMAIN-SUFFIX,metrics1.data.hicloud.com, AdBlock
DOMAIN-SUFFIX,metrics2.data.hicloud.com, AdBlock
DOMAIN-SUFFIX,metrics3.data.hicloud.com, AdBlock
DOMAIN-SUFFIX,metrics4.data.hicloud.com, AdBlock
DOMAIN-SUFFIX,metrics5.data.hicloud.com, AdBlock
DOMAIN-SUFFIX,logservice.hicloud.com, AdBlock
DOMAIN-SUFFIX,logservice1.hicloud.com, AdBlock
DOMAIN-SUFFIX,metrics-dra.dt.hicloud.com, AdBlock
DOMAIN-SUFFIX,logbak.hicloud.com, AdBlock
DOMAIN-SUFFIX,ad.samsungadhub.com, AdBlock
DOMAIN-SUFFIX,samsungadhub.com, AdBlock
DOMAIN-SUFFIX,samsungads.com, AdBlock
DOMAIN-SUFFIX,smetrics.samsung.com, AdBlock
DOMAIN-SUFFIX,nmetrics.samsung.com, AdBlock
DOMAIN-SUFFIX,samsung-com.112.2o7.net, AdBlock
DOMAIN-SUFFIX,business.samsungusa.com, AdBlock
DOMAIN-SUFFIX,analytics.samsungknox.com, AdBlock
DOMAIN-SUFFIX,bigdata.ssp.samsung.com, AdBlock
DOMAIN-SUFFIX,analytics-api.samsunghealthcn.com, AdBlock
DOMAIN-SUFFIX,config.samsungads.com, AdBlock
DOMAIN-SUFFIX,metrics.apple.com, AdBlock
DOMAIN-SUFFIX,securemetrics.apple.com, AdBlock
DOMAIN-SUFFIX,supportmetrics.apple.com, AdBlock
DOMAIN-SUFFIX,metrics.icloud.com, AdBlock
DOMAIN-SUFFIX,metrics.mzstatic.com, AdBlock
DOMAIN-SUFFIX,dzc-metrics.mzstatic.com, AdBlock
DOMAIN-SUFFIX,books-analytics-events.news.apple-dns.net, AdBlock
DOMAIN-SUFFIX,books-analytics-events.apple.com, AdBlock
DOMAIN-SUFFIX,stocks-analytics-events.apple.com, AdBlock
DOMAIN-SUFFIX,stocks-analytics-events.news.apple-dns.net, AdBlock
DOMAIN-KEYWORD,pagead2, AdBlock
DOMAIN-KEYWORD,adservice, AdBlock
DOMAIN-KEYWORD,.ads, AdBlock
DOMAIN-KEYWORD,.ad, AdBlock
DOMAIN-KEYWORD,adservetx, AdBlock
DOMAIN-KEYWORD,mediavisor, AdBlock
DOMAIN-KEYWORD,adtago, AdBlock
DOMAIN-KEYWORD,analyticsengine, AdBlock
DOMAIN-KEYWORD,advice-ads, AdBlock
DOMAIN-KEYWORD,affiliationjs, AdBlock
DOMAIN-KEYWORD,advertising, AdBlock
DOMAIN-KEYWORD,adserver, AdBlock
DOMAIN-KEYWORD,pclick, AdBlock
DOMAIN-KEYWORD,partnerads, AdBlock
DOMAIN-KEYWORD,appmetrica, AdBlock
DOMAIN-KEYWORD,adfox, AdBlock
DOMAIN-KEYWORD,adsdk, AdBlock
DOMAIN-KEYWORD,clck, AdBlock
DOMAIN-KEYWORD,metrika, AdBlock
DOMAIN-KEYWORD,api-hotjar, AdBlock
DOMAIN-KEYWORD,hotjar-analytics, AdBlock
DOMAIN-KEYWORD,hotjar, AdBlock
DOMAIN-KEYWORD,luckyorange, AdBlock
DOMAIN-KEYWORD,bugsnag, AdBlock
DOMAIN-KEYWORD,sentry-cdn, AdBlock
DOMAIN-KEYWORD,getsentry, AdBlock
DOMAIN-KEYWORD,ads-api, AdBlock
DOMAIN-KEYWORD,ads-twitter, AdBlock
DOMAIN-KEYWORD,pointdrive, AdBlock
DOMAIN-KEYWORD,ads-dev, AdBlock
DOMAIN-KEYWORD,trk, AdBlock
DOMAIN-KEYWORD,cleverads, AdBlock
DOMAIN-KEYWORD,ads-sg, AdBlock
DOMAIN-KEYWORD,analytics-sg, AdBlock
DOMAIN-KEYWORD,adspecs, AdBlock
DOMAIN-KEYWORD,adsfs, AdBlock
DOMAIN-KEYWORD,adx, AdBlock
DOMAIN-KEYWORD,tracking, AdBlock
DOMAIN-KEYWORD,logservice, AdBlock
DOMAIN-KEYWORD,logbak, AdBlock
DOMAIN-KEYWORD,smetrics, AdBlock
DOMAIN-KEYWORD,nmetrics, AdBlock
DOMAIN-KEYWORD,securemetrics, AdBlock
DOMAIN-KEYWORD,supportmetrics, AdBlock
DOMAIN-KEYWORD,books-analytics, AdBlock
DOMAIN-KEYWORD,stocks-analytics, AdBlock
DOMAIN-SUFFIX,analytics.s3.amazonaws.com, AdBlock
DOMAIN-SUFFIX,analytics.google.com, AdBlock
DOMAIN-SUFFIX,click.googleanalytics.com, AdBlock
DOMAIN-SUFFIX,events.reddit.com, AdBlock
DOMAIN-SUFFIX,business-api.tiktok.com, AdBlock
DOMAIN-SUFFIX,log.byteoversea.com, AdBlock
DOMAIN-SUFFIX,udc.yahoo.com, AdBlock
DOMAIN-SUFFIX,udcm.yahoo.com, AdBlock
DOMAIN-SUFFIX,auction.unityads.unity3d.com, AdBlock
DOMAIN-SUFFIX,webview.unityads.unity3d.com, AdBlock
DOMAIN-SUFFIX,config.unityads.unity3d.com, AdBlock
DOMAIN-SUFFIX,adfstat.yandex.ru, AdBlock
DOMAIN-SUFFIX,iot-eu-logser.realme.com, AdBlock
DOMAIN-SUFFIX,iot-logser.realme.com, AdBlock
DOMAIN-SUFFIX,bdapi-ads.realmemobile.com, AdBlock
DOMAIN-SUFFIX,grs.hicloud.com, AdBlock
DOMAIN-SUFFIX,weather-analytics-events.apple.com, AdBlock
DOMAIN-SUFFIX,notes-analytics-events.apple.com, AdBlock
FINAL,Select Group`;
}
async function generateHusiSub(type, bug, inconigtomode, tls, country = null, limit = null) {
  const proxyListResponse = await fetch(DEFAULT_PROXY_BANK_URL);
  const proxyList = await proxyListResponse.text();
  let ips = proxyList
    .split('\n')
    .filter(Boolean)
  if (country && country.toLowerCase() === 'random') {
    // Pilih data secara acak jika country=random
    ips = ips.sort(() => Math.random() - 0.5); // Acak daftar proxy
  } else if (country) {
    // Filter berdasarkan country jika bukan "random"
    ips = ips.filter(line => {
      const parts = line.split(',');
      if (parts.length > 1) {
        const lineCountry = parts[2].toUpperCase();
        return lineCountry === country.toUpperCase();
      }
      return false;
    });
  }
  if (limit && !isNaN(limit)) {
    ips = ips.slice(0, limit); // Batasi jumlah proxy berdasarkan limit
  }
  let conf = '';
  let bex = '';
  let count = 1;
  
  for (let line of ips) {
    const parts = line.split(',');
    const proxyHost = parts[0];
    const proxyPort = parts[1] || 443;
    const emojiFlag = getEmojiFlag(line.split(',')[2]); // Konversi ke emoji bendera
    const sanitize = (text) => text.replace(/[\n\r]+/g, "").trim(); // Hapus newline dan spasi ekstra
    let ispName = sanitize(`${emojiFlag} (${line.split(',')[2]}) ${line.split(',')[3]} ${count ++}`);
    const UUIDS = `${generateUUIDv4()}`;
    const ports = tls ? '443' : '80';
    const snio = tls ? `\n      "tls": {\n        "disable_sni": false,\n        "enabled": true,\n        "insecure": true,\n        "server_name": "${inconigtomode}"\n      },` : '';
    if (type === 'vless') {
      bex += `        "${ispName}",\n`
      conf += `
    {
      "domain_strategy": "ipv4_only",
      "flow": "",
      "multiplex": {
        "enabled": false,
        "max_streams": 32,
        "protocol": "smux"
      },
      "packet_encoding": "xudp",
      "server": "${bug}",
      "server_port": ${ports},
      "tag": "${ispName}",${snio}
      "transport": {
        "early_data_header_name": "Sec-WebSocket-Protocol",
        "headers": {
          "Host": "${inconigtomode}"
        },
        "max_early_data": 0,
        "path": "/${proxyHost}=${proxyPort}",
        "type": "ws"
      },
      "type": "vless",
      "uuid": "${UUIDS}"
    },`;
    } else if (type === 'trojan') {
      bex += `        "${ispName}",\n`
      conf += `
    {
      "domain_strategy": "ipv4_only",
      "multiplex": {
        "enabled": false,
        "max_streams": 32,
        "protocol": "smux"
      },
      "password": "${UUIDS}",
      "server": "${bug}",
      "server_port": ${ports},
      "tag": "${ispName}",${snio}
      "transport": {
        "early_data_header_name": "Sec-WebSocket-Protocol",
        "headers": {
          "Host": "${inconigtomode}"
        },
        "max_early_data": 0,
        "path": "/${proxyHost}=${proxyPort}",
        "type": "ws"
      },
      "type": "trojan"
    },`;
    } else if (type === 'shadowsocks') {
      bex += `        "${ispName}",\n`
      conf += `
    {
      "type": "shadowsocks",
      "tag": "${ispName}",
      "server": "${bug}",
      "server_port": 443,
      "method": "none",
      "password": "${UUIDS}",
      "plugin": "v2ray-plugin",
      "plugin_opts": "mux=0;path=/${proxyHost}=${proxyPort};host=${inconigtomode};tls=1"
    },`;
    } else if (type === 'mix') {
      bex += `        "${ispName} vless",\n        "${ispName} trojan",\n        "${ispName} ss",\n`
      conf += `
    {
      "domain_strategy": "ipv4_only",
      "flow": "",
      "multiplex": {
        "enabled": false,
        "max_streams": 32,
        "protocol": "smux"
      },
      "packet_encoding": "xudp",
      "server": "${bug}",
      "server_port": ${ports},
      "tag": "${ispName} vless",${snio}
      "transport": {
        "early_data_header_name": "Sec-WebSocket-Protocol",
        "headers": {
          "Host": "${inconigtomode}"
        },
        "max_early_data": 0,
        "path": "/${proxyHost}=${proxyPort}",
        "type": "ws"
      },
      "type": "vless",
      "uuid": "${UUIDS}"
    },
    {
      "domain_strategy": "ipv4_only",
      "multiplex": {
        "enabled": false,
        "max_streams": 32,
        "protocol": "smux"
      },
      "password": "${UUIDS}",
      "server": "${bug}",
      "server_port": ${ports},
      "tag": "${ispName} trojan",${snio}
      "transport": {
        "early_data_header_name": "Sec-WebSocket-Protocol",
        "headers": {
          "Host": "${inconigtomode}"
        },
        "max_early_data": 0,
        "path": "/${proxyHost}=${proxyPort}",
        "type": "ws"
      },
      "type": "trojan"
    },
    {
      "type": "shadowsocks",
      "tag": "${ispName} ss",
      "server": "${bug}",
      "server_port": 443,
      "method": "none",
      "password": "${UUIDS}",
      "plugin": "v2ray-plugin",
      "plugin_opts": "mux=0;path=/${proxyHost}=${proxyPort};host=${inconigtomode};tls=1"
    },`;
    }
  }
  return `


{
  "dns": {
    "final": "dns-final",
    "independent_cache": true,
    "rules": [
      {
        "disable_cache": false,
        "domain": [
          "family.cloudflare-dns.com",
          "${bug}"
        ],
        "server": "direct-dns"
      }
    ],
    "servers": [
      {
        "address": "https://family.cloudflare-dns.com/dns-query",
        "address_resolver": "direct-dns",
        "strategy": "ipv4_only",
        "tag": "remote-dns"
      },
      {
        "address": "local",
        "strategy": "ipv4_only",
        "tag": "direct-dns"
      },
      {
        "address": "local",
        "address_resolver": "dns-local",
        "strategy": "ipv4_only",
        "tag": "dns-final"
      },
      {
        "address": "local",
        "tag": "dns-local"
      },
      {
        "address": "rcode://success",
        "tag": "dns-block"
      }
    ]
  },
  "experimental": {
    "cache_file": {
      "enabled": true,
      "path": "../cache/cache.db",
      "store_fakeip": true
    },
    "clash_api": {
      "external_controller": "127.0.0.1:9090"
    },
    "v2ray_api": {
      "listen": "127.0.0.1:0",
      "stats": {
        "enabled": true,
        "outbounds": [
          "proxy",
          "direct"
        ]
      }
    }
  },
  "inbounds": [
    {
      "listen": "0.0.0.0",
      "listen_port": 6450,
      "override_address": "8.8.8.8",
      "override_port": 53,
      "tag": "dns-in",
      "type": "direct"
    },
    {
      "domain_strategy": "",
      "endpoint_independent_nat": true,
      "inet4_address": [
        "172.19.0.1/28"
      ],
      "mtu": 9000,
      "sniff": true,
      "sniff_override_destination": true,
      "stack": "system",
      "tag": "tun-in",
      "type": "tun"
    },
    {
      "domain_strategy": "",
      "listen": "0.0.0.0",
      "listen_port": 2080,
      "sniff": true,
      "sniff_override_destination": true,
      "tag": "mixed-in",
      "type": "mixed"
    }
  ],
  "log": {
    "level": "info"
  },
  "outbounds": [
    {
      "outbounds": [
        "Best Latency",
${bex}        "direct"
      ],
      "tag": "Internet",
      "type": "selector"
    },
    {
      "interval": "1m0s",
      "outbounds": [
${bex}        "direct"
      ],
      "tag": "Best Latency",
      "type": "urltest",
      "url": "https://detectportal.firefox.com/success.txt"
    },
${conf}
    {
      "tag": "direct",
      "type": "direct"
    },
    {
      "tag": "bypass",
      "type": "direct"
    },
    {
      "tag": "block",
      "type": "block"
    },
    {
      "tag": "dns-out",
      "type": "dns"
    }
  ],
  "route": {
    "auto_detect_interface": true,
    "rules": [
      {
        "outbound": "dns-out",
        "port": [
          53
        ]
      },
      {
        "inbound": [
          "dns-in"
        ],
        "outbound": "dns-out"
      },
      {
        "network": [
          "udp"
        ],
        "outbound": "block",
        "port": [
          443
        ],
        "port_range": []
      },
      {
        "ip_cidr": [
          "224.0.0.0/3",
          "ff00::/8"
        ],
        "outbound": "block",
        "source_ip_cidr": [
          "224.0.0.0/3",
          "ff00::/8"
        ]
      }
    ]
  }
}`;
}
async function generateSingboxSub(type, bug, inconigtomode, tls, country = null, limit = null) {
  const proxyListResponse = await fetch(DEFAULT_PROXY_BANK_URL);
  const proxyList = await proxyListResponse.text();
  let ips = proxyList
    .split('\n')
    .filter(Boolean)
  if (country && country.toLowerCase() === 'random') {
    // Pilih data secara acak jika country=random
    ips = ips.sort(() => Math.random() - 0.5); // Acak daftar proxy
  } else if (country) {
    // Filter berdasarkan country jika bukan "random"
    ips = ips.filter(line => {
      const parts = line.split(',');
      if (parts.length > 1) {
        const lineCountry = parts[2].toUpperCase();
        return lineCountry === country.toUpperCase();
      }
      return false;
    });
  }
  if (limit && !isNaN(limit)) {
    ips = ips.slice(0, limit); // Batasi jumlah proxy berdasarkan limit
  }
  let conf = '';
  let bex = '';
  let count = 1;
  
  for (let line of ips) {
    const parts = line.split(',');
    const proxyHost = parts[0];
    const proxyPort = parts[1] || 443;
    const emojiFlag = getEmojiFlag(line.split(',')[2]); // Konversi ke emoji bendera
    const sanitize = (text) => text.replace(/[\n\r]+/g, "").trim(); // Hapus newline dan spasi ekstra
    let ispName = sanitize(`${emojiFlag} (${line.split(',')[2]}) ${line.split(',')[3]} ${count ++}`);
    const UUIDS = `${generateUUIDv4()}`;
    const ports = tls ? '443' : '80';
    const snio = tls ? `\n      "tls": {\n        "enabled": true,\n        "server_name": "${inconigtomode}",\n        "insecure": true\n      },` : '';
    if (type === 'vless') {
      bex += `        "${ispName}",\n`
      conf += `
    {
      "type": "vless",
      "tag": "${ispName}",
      "domain_strategy": "ipv4_only",
      "server": "${bug}",
      "server_port": ${ports},
      "uuid": "${UUIDS}",${snio}
      "multiplex": {
        "protocol": "smux",
        "max_streams": 32
      },
      "transport": {
        "type": "ws",
        "path": "/${proxyHost}=${proxyPort}",
        "headers": {
          "Host": "${inconigtomode}"
        },
        "early_data_header_name": "Sec-WebSocket-Protocol"
      },
      "packet_encoding": "xudp"
    },`;
    } else if (type === 'trojan') {
      bex += `        "${ispName}",\n`
      conf += `
    {
      "type": "trojan",
      "tag": "${ispName}",
      "domain_strategy": "ipv4_only",
      "server": "${bug}",
      "server_port": ${ports},
      "password": "${UUIDS}",${snio}
      "multiplex": {
        "protocol": "smux",
        "max_streams": 32
      },
      "transport": {
        "type": "ws",
        "path": "/${proxyHost}=${proxyPort}",
        "headers": {
          "Host": "${inconigtomode}"
        },
        "early_data_header_name": "Sec-WebSocket-Protocol"
      }
    },`;
    } else if (type === 'shadowsocks') {
      bex += `        "${ispName}",\n`
      conf += `
    {
      "type": "shadowsocks",
      "tag": "${ispName}",
      "server": "${bug}",
      "server_port": 443,
      "method": "none",
      "password": "${UUIDS}",
      "plugin": "v2ray-plugin",
      "plugin_opts": "mux=0;path=/${proxyHost}=${proxyPort};host=${inconigtomode};tls=1"
    },`;
    } else if (type === 'mix') {
      bex += `        "${ispName} vless",\n        "${ispName} trojan",\n        "${ispName} ss",\n`
      conf += `
    {
      "type": "vless",
      "tag": "${ispName} vless",
      "domain_strategy": "ipv4_only",
      "server": "${bug}",
      "server_port": ${ports},
      "uuid": "${UUIDS}",${snio}
      "multiplex": {
        "protocol": "smux",
        "max_streams": 32
      },
      "transport": {
        "type": "ws",
        "path": "/${proxyHost}=${proxyPort}",
        "headers": {
          "Host": "${inconigtomode}"
        },
        "early_data_header_name": "Sec-WebSocket-Protocol"
      },
      "packet_encoding": "xudp"
    },
    {
      "type": "trojan",
      "tag": "${ispName} trojan",
      "domain_strategy": "ipv4_only",
      "server": "${bug}",
      "server_port": ${ports},
      "password": "${UUIDS}",${snio}
      "multiplex": {
        "protocol": "smux",
        "max_streams": 32
      },
      "transport": {
        "type": "ws",
        "path": "/${proxyHost}=${proxyPort}",
        "headers": {
          "Host": "${inconigtomode}"
        },
        "early_data_header_name": "Sec-WebSocket-Protocol"
      }
    },
    {
      "type": "shadowsocks",
      "tag": "${ispName} ss",
      "server": "${bug}",
      "server_port": 443,
      "method": "none",
      "password": "${UUIDS}",
      "plugin": "v2ray-plugin",
      "plugin_opts": "mux=0;path=/${proxyHost}=${proxyPort};host=${inconigtomode};tls=1"
    },`;
    }
  }
  return `


{
  "log": {
    "level": "info"
  },
  "dns": {
    "servers": [
      {
        "tag": "remote-dns",
        "address": "https://family.cloudflare-dns.com/dns-query",
        "address_resolver": "direct-dns",
        "strategy": "ipv4_only"
      },
      {
        "tag": "direct-dns",
        "address": "local",
        "strategy": "ipv4_only"
      },
      {
        "tag": "dns-final",
        "address": "local",
        "address_resolver": "dns-local",
        "strategy": "ipv4_only"
      },
      {
        "tag": "dns-local",
        "address": "local"
      },
      {
        "tag": "dns-block",
        "address": "rcode://success"
      }
    ],
    "rules": [
      {
        "domain": [
          "family.cloudflare-dns.com",
          "${bug}"
        ],
        "server": "direct-dns"
      }
    ],
    "final": "dns-final",
    "independent_cache": true
  },
  "inbounds": [
    {
      "type": "tun",
      "mtu": 1400,
      "inet4_address": "172.19.0.1/30",
      "inet6_address": "fdfe:dcba:9876::1/126",
      "auto_route": true,
      "strict_route": true,
      "endpoint_independent_nat": true,
      "stack": "mixed",
      "sniff": true
    }
  ],
  "outbounds": [
    {
      "tag": "Internet",
      "type": "selector",
      "outbounds": [
        "Best Latency",
${bex}        "direct"
      ]
    },
    {
      "type": "urltest",
      "tag": "Best Latency",
      "outbounds": [
${bex}        "direct"
      ],
      "url": "https://ping.inconigtomode.us.kg",
      "interval": "30s"
    },
${conf}
    {
      "type": "direct",
      "tag": "direct"
    },
    {
      "type": "direct",
      "tag": "bypass"
    },
    {
      "type": "block",
      "tag": "block"
    },
    {
      "type": "dns",
      "tag": "dns-out"
    }
  ],
  "route": {
    "rules": [
      {
        "port": 53,
        "outbound": "dns-out"
      },
      {
        "inbound": "dns-in",
        "outbound": "dns-out"
      },
      {
        "network": "udp",
        "port": 443,
        "outbound": "block"
      },
      {
        "source_ip_cidr": [
          "224.0.0.0/3",
          "ff00::/8"
        ],
        "ip_cidr": [
          "224.0.0.0/3",
          "ff00::/8"
        ],
        "outbound": "block"
      }
    ],
    "auto_detect_interface": true
  },
  "experimental": {
    "cache_file": {
      "enabled": false
    },
    "clash_api": {
      "external_controller": "127.0.0.1:9090",
      "external_ui": "ui",
      "external_ui_download_url": "https://github.com/MetaCubeX/metacubexd/archive/gh-pages.zip",
      "external_ui_download_detour": "Internet",
      "secret": "bitzblack",
      "default_mode": "rule"
    }
  }
}`;
}
async function generateNekoboxSub(type, bug, inconigtomode, tls, country = null, limit = null) {
  const proxyListResponse = await fetch(DEFAULT_PROXY_BANK_URL);
  const proxyList = await proxyListResponse.text();
  let ips = proxyList
    .split('\n')
    .filter(Boolean)
  if (country && country.toLowerCase() === 'random') {
    // Pilih data secara acak jika country=random
    ips = ips.sort(() => Math.random() - 0.5); // Acak daftar proxy
  } else if (country) {
    // Filter berdasarkan country jika bukan "random"
    ips = ips.filter(line => {
      const parts = line.split(',');
      if (parts.length > 1) {
        const lineCountry = parts[2].toUpperCase();
        return lineCountry === country.toUpperCase();
      }
      return false;
    });
  }
  if (limit && !isNaN(limit)) {
    ips = ips.slice(0, limit); // Batasi jumlah proxy berdasarkan limit
  }
  let conf = '';
  let bex = '';
  let count = 1;
  
  for (let line of ips) {
    const parts = line.split(',');
    const proxyHost = parts[0];
    const proxyPort = parts[1] || 443;
    const emojiFlag = getEmojiFlag(line.split(',')[2]); // Konversi ke emoji bendera
    const sanitize = (text) => text.replace(/[\n\r]+/g, "").trim(); // Hapus newline dan spasi ekstra
    let ispName = sanitize(`${emojiFlag} (${line.split(',')[2]}) ${line.split(',')[3]} ${count ++}`);
    const UUIDS = `${generateUUIDv4()}`;
    const ports = tls ? '443' : '80';
    const snio = tls ? `\n      "tls": {\n        "disable_sni": false,\n        "enabled": true,\n        "insecure": true,\n        "server_name": "${inconigtomode}"\n      },` : '';
    if (type === 'vless') {
      bex += `        "${ispName}",\n`
      conf += `
    {
      "domain_strategy": "ipv4_only",
      "flow": "",
      "multiplex": {
        "enabled": false,
        "max_streams": 32,
        "protocol": "smux"
      },
      "packet_encoding": "xudp",
      "server": "${bug}",
      "server_port": ${ports},
      "tag": "${ispName}",${snio}
      "transport": {
        "early_data_header_name": "Sec-WebSocket-Protocol",
        "headers": {
          "Host": "${inconigtomode}"
        },
        "max_early_data": 0,
        "path": "/${proxyHost}=${proxyPort}",
        "type": "ws"
      },
      "type": "vless",
      "uuid": "${UUIDS}"
    },`;
    } else if (type === 'trojan') {
      bex += `        "${ispName}",\n`
      conf += `
    {
      "domain_strategy": "ipv4_only",
      "multiplex": {
        "enabled": false,
        "max_streams": 32,
        "protocol": "smux"
      },
      "password": "${UUIDS}",
      "server": "${bug}",
      "server_port": ${ports},
      "tag": "${ispName}",${snio}
      "transport": {
        "early_data_header_name": "Sec-WebSocket-Protocol",
        "headers": {
          "Host": "${inconigtomode}"
        },
        "max_early_data": 0,
        "path": "/${proxyHost}=${proxyPort}",
        "type": "ws"
      },
      "type": "trojan"
    },`;
    } else if (type === 'shadowsocks') {
      bex += `        "${ispName}",\n`
      conf += `
    {
      "type": "shadowsocks",
      "tag": "${ispName}",
      "server": "${bug}",
      "server_port": 443,
      "method": "none",
      "password": "${UUIDS}",
      "plugin": "v2ray-plugin",
      "plugin_opts": "mux=0;path=/${proxyHost}=${proxyPort};host=${inconigtomode};tls=1"
    },`;
    } else if (type === 'mix') {
      bex += `        "${ispName} vless",\n        "${ispName} trojan",\n        "${ispName} ss",\n`
      conf += `
    {
      "domain_strategy": "ipv4_only",
      "flow": "",
      "multiplex": {
        "enabled": false,
        "max_streams": 32,
        "protocol": "smux"
      },
      "packet_encoding": "xudp",
      "server": "${bug}",
      "server_port": ${ports},
      "tag": "${ispName} vless",${snio}
      "transport": {
        "early_data_header_name": "Sec-WebSocket-Protocol",
        "headers": {
          "Host": "${inconigtomode}"
        },
        "max_early_data": 0,
        "path": "/${proxyHost}=${proxyPort}",
        "type": "ws"
      },
      "type": "vless",
      "uuid": "${UUIDS}"
    },
    {
      "domain_strategy": "ipv4_only",
      "multiplex": {
        "enabled": false,
        "max_streams": 32,
        "protocol": "smux"
      },
      "password": "${UUIDS}",
      "server": "${bug}",
      "server_port": ${ports},
      "tag": "${ispName} trojan",${snio}
      "transport": {
        "early_data_header_name": "Sec-WebSocket-Protocol",
        "headers": {
          "Host": "${inconigtomode}"
        },
        "max_early_data": 0,
        "path": "/${proxyHost}=${proxyPort}",
        "type": "ws"
      },
      "type": "trojan"
    },
    {
      "type": "shadowsocks",
      "tag": "${ispName} ss",
      "server": "${bug}",
      "server_port": 443,
      "method": "none",
      "password": "${UUIDS}",
      "plugin": "v2ray-plugin",
      "plugin_opts": "mux=0;path=/${proxyHost}=${proxyPort};host=${inconigtomode};tls=1"
    },`;
    }
  }
  return `


{
  "dns": {
    "final": "dns-final",
    "independent_cache": true,
    "rules": [
      {
        "disable_cache": false,
        "domain": [
          "family.cloudflare-dns.com",
          "${bug}"
        ],
        "server": "direct-dns"
      }
    ],
    "servers": [
      {
        "address": "https://family.cloudflare-dns.com/dns-query",
        "address_resolver": "direct-dns",
        "strategy": "ipv4_only",
        "tag": "remote-dns"
      },
      {
        "address": "local",
        "strategy": "ipv4_only",
        "tag": "direct-dns"
      },
      {
        "address": "local",
        "address_resolver": "dns-local",
        "strategy": "ipv4_only",
        "tag": "dns-final"
      },
      {
        "address": "local",
        "tag": "dns-local"
      },
      {
        "address": "rcode://success",
        "tag": "dns-block"
      }
    ]
  },
  "experimental": {
    "cache_file": {
      "enabled": true,
      "path": "../cache/clash.db",
      "store_fakeip": true
    },
    "clash_api": {
      "external_controller": "127.0.0.1:9090",
      "external_ui": "../files/yacd"
    }
  },
  "inbounds": [
    {
      "listen": "0.0.0.0",
      "listen_port": 6450,
      "override_address": "8.8.8.8",
      "override_port": 53,
      "tag": "dns-in",
      "type": "direct"
    },
    {
      "domain_strategy": "",
      "endpoint_independent_nat": true,
      "inet4_address": [
        "172.19.0.1/28"
      ],
      "mtu": 9000,
      "sniff": true,
      "sniff_override_destination": true,
      "stack": "system",
      "tag": "tun-in",
      "type": "tun"
    },
    {
      "domain_strategy": "",
      "listen": "0.0.0.0",
      "listen_port": 2080,
      "sniff": true,
      "sniff_override_destination": true,
      "tag": "mixed-in",
      "type": "mixed"
    }
  ],
  "log": {
    "level": "info"
  },
  "outbounds": [
    {
      "outbounds": [
        "Best Latency",
${bex}        "direct"
      ],
      "tag": "Internet",
      "type": "selector"
    },
    {
      "interval": "1m0s",
      "outbounds": [
${bex}        "direct"
      ],
      "tag": "Best Latency",
      "type": "urltest",
      "url": "https://detectportal.firefox.com/success.txt"
    },
${conf}
    {
      "tag": "direct",
      "type": "direct"
    },
    {
      "tag": "bypass",
      "type": "direct"
    },
    {
      "tag": "block",
      "type": "block"
    },
    {
      "tag": "dns-out",
      "type": "dns"
    }
  ],
  "route": {
    "auto_detect_interface": true,
    "rules": [
      {
        "outbound": "dns-out",
        "port": [
          53
        ]
      },
      {
        "inbound": [
          "dns-in"
        ],
        "outbound": "dns-out"
      },
      {
        "network": [
          "udp"
        ],
        "outbound": "block",
        "port": [
          443
        ],
        "port_range": []
      },
      {
        "ip_cidr": [
          "224.0.0.0/3",
          "ff00::/8"
        ],
        "outbound": "block",
        "source_ip_cidr": [
          "224.0.0.0/3",
          "ff00::/8"
        ]
      }
    ]
  }
}`;
}
async function generateV2rayngSub(type, bug, inconigtomode, tls, country = null, limit = null) {
  const proxyListResponse = await fetch(DEFAULT_PROXY_BANK_URL);
  const proxyList = await proxyListResponse.text();
  let ips = proxyList
    .split('\n')
    .filter(Boolean);

  if (country && country.toLowerCase() === 'random') {
    // Pilih data secara acak jika country=random
    ips = ips.sort(() => Math.random() - 0.5); // Acak daftar proxy
  } else if (country) {
    // Filter berdasarkan country jika bukan "random"
    ips = ips.filter(line => {
      const parts = line.split(',');
      if (parts.length > 1) {
        const lineCountry = parts[2].toUpperCase();
        return lineCountry === country.toUpperCase();
      }
      return false;
    });
  }
  
  if (limit && !isNaN(limit)) {
    ips = ips.slice(0, limit); // Batasi jumlah proxy berdasarkan limit
  }

  let conf = '';

  for (let line of ips) {
    const parts = line.split(',');
    const proxyHost = parts[0];
    const proxyPort = parts[1] || 443;
    const countryCode = parts[2]; // Kode negara ISO
    const isp = parts[3]; // Informasi ISP

    // Gunakan teks Latin-1 untuk menggantikan emoji flag
    const countryText = `[${countryCode}]`; // Format bendera ke teks Latin-1
    const ispInfo = `${countryText} ${isp}`;
    const UUIDS = `${generateUUIDv4()}`;

    if (type === 'vless') {
      if (tls) {
        conf += `vless://${UUIDS}\u0040${bug}:443?encryption=none&security=tls&sni=${inconigtomode}&fp=randomized&type=ws&host=${inconigtomode}&path=%2F${proxyHost}%3D${proxyPort}#${ispInfo}\n`;
      } else {
        conf += `vless://${UUIDS}\u0040${bug}:80?path=%2F${proxyHost}%3D${proxyPort}&security=none&encryption=none&host=${inconigtomode}&fp=randomized&type=ws&sni=${inconigtomode}#${ispInfo}\n`;
      }
    } else if (type === 'trojan') {
      if (tls) {
        conf += `trojan://${UUIDS}\u0040${bug}:443?encryption=none&security=tls&sni=${inconigtomode}&fp=randomized&type=ws&host=${inconigtomode}&path=%2F${proxyHost}%3D${proxyPort}#${ispInfo}\n`;
      } else {
        conf += `trojan://${UUIDS}\u0040${bug}:80?path=%2F${proxyHost}%3D${proxyPort}&security=none&encryption=none&host=${inconigtomode}&fp=randomized&type=ws&sni=${inconigtomode}#${ispInfo}\n`;
      }
    } else if (type === 'shadowsocks') {
      if (tls) {
        conf += `ss://${btoa(`none:${UUIDS}`)}%3D@${bug}:443?encryption=none&type=ws&host=${inconigtomode}&path=%2F${proxyHost}%3D${proxyPort}&security=tls&sni=${inconigtomode}#${ispInfo}\n`;
      } else {
        conf += `ss://${btoa(`none:${UUIDS}`)}%3D@${bug}:80?encryption=none&type=ws&host=${inconigtomode}&path=%2F${proxyHost}%3D${proxyPort}&security=none&sni=${inconigtomode}#${ispInfo}\n`;
      }
    } else if (type === 'mix') {
      if (tls) {
        conf += `vless://${UUIDS}\u0040${bug}:443?encryption=none&security=tls&sni=${inconigtomode}&fp=randomized&type=ws&host=${inconigtomode}&path=%2F${proxyHost}%3D${proxyPort}#${ispInfo}\n`;
        conf += `trojan://${UUIDS}\u0040${bug}:443?encryption=none&security=tls&sni=${inconigtomode}&fp=randomized&type=ws&host=${inconigtomode}&path=%2F${proxyHost}%3D${proxyPort}#${ispInfo}\n`;
        conf += `ss://${btoa(`none:${UUIDS}`)}%3D@${bug}:443?encryption=none&type=ws&host=${inconigtomode}&path=%2F${proxyHost}%3D${proxyPort}&security=tls&sni=${inconigtomode}#${ispInfo}\n`;
      } else {
        conf += `vless://${UUIDS}\u0040${bug}:80?path=%2F${proxyHost}%3D${proxyPort}&security=none&encryption=none&host=${inconigtomode}&fp=randomized&type=ws&sni=${inconigtomode}#${ispInfo}\n`;
        conf += `trojan://${UUIDS}\u0040${bug}:80?path=%2F${proxyHost}%3D${proxyPort}&security=none&encryption=none&host=${inconigtomode}&fp=randomized&type=ws&sni=${inconigtomode}#${ispInfo}\n`;
        conf += `ss://${btoa(`none:${UUIDS}`)}%3D@${bug}:80?encryption=none&type=ws&host=${inconigtomode}&path=%2F${proxyHost}%3D${proxyPort}&security=none&sni=${inconigtomode}#${ispInfo}\n`;
      }
    }
  }

  const base64Conf = btoa(conf.replace(/ /g, '%20'));

  return base64Conf;
}
async function generateV2raySub(type, bug, inconigtomode, tls, country = null, limit = null) {
  const proxyListResponse = await fetch(DEFAULT_PROXY_BANK_URL);
  const proxyList = await proxyListResponse.text();
  let ips = proxyList
    .split('\n')
    .filter(Boolean)
  if (country && country.toLowerCase() === 'random') {
    // Pilih data secara acak jika country=random
    ips = ips.sort(() => Math.random() - 0.5); // Acak daftar proxy
  } else if (country) {
    // Filter berdasarkan country jika bukan "random"
    ips = ips.filter(line => {
      const parts = line.split(',');
      if (parts.length > 1) {
        const lineCountry = parts[2].toUpperCase();
        return lineCountry === country.toUpperCase();
      }
      return false;
    });
  }
  if (limit && !isNaN(limit)) {
    ips = ips.slice(0, limit); // Batasi jumlah proxy berdasarkan limit
  }
  let conf = '';
  for (let line of ips) {
    const parts = line.split(',');
    const proxyHost = parts[0];
    const proxyPort = parts[1] || 443;
    const emojiFlag = getEmojiFlag(line.split(',')[2]); // Konversi ke emoji bendera
    const UUIDS = generateUUIDv4();
    const information = encodeURIComponent(`${emojiFlag} (${line.split(',')[2]}) ${line.split(',')[3]}`);
    if (type === 'vless') {
      if (tls) {
        conf += `vless://${UUIDS}@${bug}:443?encryption=none&security=tls&sni=${inconigtomode}&fp=randomized&type=ws&host=${inconigtomode}&path=%2F${proxyHost}%3D${proxyPort}#${information}\n`;
      } else {
        conf += `vless://${UUIDS}@${bug}:80?path=%2F${proxyHost}%3D${proxyPort}&security=none&encryption=none&host=${inconigtomode}&fp=randomized&type=ws&sni=${inconigtomode}#${information}\n`;
      }
    } else if (type === 'trojan') {
      if (tls) {
        conf += `trojan://${UUIDS}@${bug}:443?encryption=none&security=tls&sni=${inconigtomode}&fp=randomized&type=ws&host=${inconigtomode}&path=%2F${proxyHost}%3D${proxyPort}#${information}\n`;
      } else {
        conf += `trojan://${UUIDS}@${bug}:80?path=%2F${proxyHost}%3D${proxyPort}&security=none&encryption=none&host=${inconigtomode}&fp=randomized&type=ws&sni=${inconigtomode}#${information}\n`;
      }
    } else if (type === 'shadowsocks') {
      if (tls) {
        conf += `ss://${btoa(`none:${UUIDS}`)}%3D@${bug}:443?encryption=none&type=ws&host=${inconigtomode}&path=%2F${proxyHost}%3D${proxyPort}&security=tls&sni=${inconigtomode}#${information}\n`;
      } else {
        conf += `ss://${btoa(`none:${UUIDS}`)}%3D@${bug}:80?encryption=none&type=ws&host=${inconigtomode}&path=%2F${proxyHost}%3D${proxyPort}&security=none&sni=${inconigtomode}#${information}\n`;
      }
    } else if (type === 'mix') {
      if (tls) {
        conf += `vless://${UUIDS}@${bug}:443?encryption=none&security=tls&sni=${inconigtomode}&fp=randomized&type=ws&host=${inconigtomode}&path=%2F${proxyHost}%3D${proxyPort}#${information}\n`;
        conf += `trojan://${UUIDS}@${bug}:443?encryption=none&security=tls&sni=${inconigtomode}&fp=randomized&type=ws&host=${inconigtomode}&path=%2F${proxyHost}%3D${proxyPort}#${information}\n`;
        conf += `ss://${btoa(`none:${UUIDS}`)}%3D@${bug}:443?encryption=none&type=ws&host=${inconigtomode}&path=%2F${proxyHost}%3D${proxyPort}&security=tls&sni=${inconigtomode}#${information}\n`;
      } else {
        conf += `vless://${UUIDS}@${bug}:80?path=%2F${proxyHost}%3D${proxyPort}&security=none&encryption=none&host=${inconigtomode}&fp=randomized&type=ws&sni=${inconigtomode}#${information}\n`;
        conf += `trojan://${UUIDS}@${bug}:80?path=%2F${proxyHost}%3D${proxyPort}&security=none&encryption=none&host=${inconigtomode}&fp=randomized&type=ws&sni=${inconigtomode}#${information}\n`;
        conf += `ss://${btoa(`none:${UUIDS}`)}%3D@${bug}:80?encryption=none&type=ws&host=${inconigtomode}&path=%2F${proxyHost}%3D${proxyPort}&security=none&sni=${inconigtomode}#${information}\n`;
      }
    }
  }
  
  return conf;
}
function generateUUIDv4() {
  const randomValues = crypto.getRandomValues(new Uint8Array(16));
  randomValues[6] = (randomValues[6] & 0x0f) | 0x40;
  randomValues[8] = (randomValues[8] & 0x3f) | 0x80;
  return [
    randomValues[0].toString(16).padStart(2, '0'),
    randomValues[1].toString(16).padStart(2, '0'),
    randomValues[2].toString(16).padStart(2, '0'),
    randomValues[3].toString(16).padStart(2, '0'),
    randomValues[4].toString(16).padStart(2, '0'),
    randomValues[5].toString(16).padStart(2, '0'),
    randomValues[6].toString(16).padStart(2, '0'),
    randomValues[7].toString(16).padStart(2, '0'),
    randomValues[8].toString(16).padStart(2, '0'),
    randomValues[9].toString(16).padStart(2, '0'),
    randomValues[10].toString(16).padStart(2, '0'),
    randomValues[11].toString(16).padStart(2, '0'),
    randomValues[12].toString(16).padStart(2, '0'),
    randomValues[13].toString(16).padStart(2, '0'),
    randomValues[14].toString(16).padStart(2, '0'),
    randomValues[15].toString(16).padStart(2, '0'),
  ].join('').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}
