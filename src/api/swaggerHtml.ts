/**
 * Standalone HTML page with CDN-embedded Swagger UI
 * restyled elegantly to pair with Sentinel's dark, premium space aesthetics.
 */
export function getSwaggerHtml(openapiSpecUrl: string = "/api/v1/openapi.json"): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sentinel Core API - Developer Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
  <style>
    /* Premium off-black & emerald theme restyling for Swagger UI */
    html, body {
      box-sizing: border-box;
      margin: 0;
      background-color: #09090c;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    
    #swagger-ui {
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px 16px;
    }

    /* Elegant brand banner above documentation */
    .sentinel-banner {
      background: linear-gradient(135deg, #10b981 0%, #3b82f6 50%, #6366f1 100%);
      padding: 30px;
      border-radius: 12px;
      color: white;
      margin-bottom: 24px;
      font-family: inherit;
      box-shadow: 0 10px 30px -10px rgba(16, 185, 129, 0.3);
      position: relative;
      overflow: hidden;
    }
    
    .sentinel-banner::after {
      content: '';
      position: absolute;
      top: -50%;
      left: -50%;
      width: 200%;
      height: 200%;
      background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 60%);
      pointer-events: none;
    }

    .sentinel-banner h1 {
      margin: 0 0 8px 0;
      font-size: 26px;
      font-weight: 800;
      letter-spacing: -0.025em;
    }

    .sentinel-banner p {
      margin: 0;
      font-size: 13.5px;
      opacity: 0.9;
      line-height: 1.5;
    }

    .sentinel-banner .mono-badge {
      font-family: monospace;
      background: rgba(0,0,0,0.3);
      border: 1px solid rgba(255,255,255,0.1);
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
      letter-spacing: 0.05em;
    }

    /* Restyling Swagger elements to dark theme colors */
    .swagger-ui {
      background-color: #09090c;
    }
    .swagger-ui .info {
      margin: 24px 0 !important;
    }
    .swagger-ui .info .title, 
    .swagger-ui .info p, 
    .swagger-ui .info li, 
    .swagger-ui .info a,
    .swagger-ui .info h1,
    .swagger-ui .info h2,
    .swagger-ui .info h3,
    .swagger-ui .info h4,
    .swagger-ui .info h5 {
      color: #e4e4e7 !important;
    }
    
    .swagger-ui .info a {
      color: #10b981 !important;
    }
    
    .swagger-ui .scheme-container {
      background-color: #121217 !important;
      box-shadow: none !important;
      border: 1px solid #1f1f2e !important;
      border-radius: 8px !important;
      padding: 16px !important;
      margin: 20px 0 !important;
    }
    
    .swagger-ui .scheme-container select {
      background-color: #09090c !important;
      color: #ffffff !important;
      border: 1px solid #2e2e42 !important;
    }

    .swagger-ui .btn.authorize {
      border-color: #10b981 !important;
      color: #10b981 !important;
      background: transparent !important;
    }
    .swagger-ui .btn.authorize svg {
      fill: #10b981 !important;
    }

    .swagger-ui .opblock {
      background: #111115 !important;
      border-radius: 8px !important;
      box-shadow: none !important;
      border: 1px solid #1f1f2a !important;
    }
    
    .swagger-ui .opblock .opblock-summary-method {
      border-radius: 6px !important;
      font-weight: 700 !important;
      text-shadow: none !important;
    }

    .swagger-ui .opblock-summary-path,
    .swagger-ui .opblock-summary-description {
      color: #f4f4f5 !important;
    }

    .swagger-ui .tabli button {
      color: #a1a1aa !important;
    }
    
    .swagger-ui .tabli.active button {
      color: #ffffff !important;
      border-bottom-color: #10b981 !important;
    }

    .swagger-ui .opblock-body pre {
      background: #050507 !important;
      border: 1px solid #1e1e2d !important;
      border-radius: 6px !important;
    }

    .swagger-ui .opblock-description-wrapper p,
    .swagger-ui .opblock-external-docs-wrapper p,
    .swagger-ui .opblock-title_normal p {
      color: #a1a1aa !important;
    }

    .swagger-ui table thead tr td,
    .swagger-ui table thead tr th {
      color: #ffffff !important;
      border-bottom-color: #1e1e2d !important;
    }

    .swagger-ui .parameter__name,
    .swagger-ui .parameter__type {
      color: #e4e4e7 !important;
    }

    .swagger-ui .parameter__in {
      color: #71717a !important;
    }

    .swagger-ui input[type=text],
    .swagger-ui textarea {
      background: #09090c !important;
      border: 1px solid #2d2d3d !important;
      color: #ffffff !important;
      border-radius: 4px !important;
    }

    .swagger-ui .response-col_status {
      color: #ffffff !important;
    }

    .swagger-ui .response-col_links {
      color: #a1a1aa !important;
    }

    .swagger-ui .btn.execute {
      background-color: #10b981 !important;
      border-color: #10b981 !important;
      color: #ffffff !important;
    }

    .swagger-ui .btn.execute:hover {
      background-color: #059669 !important;
      border-color: #059669 !important;
    }

    /* Model Schema stylings */
    .swagger-ui .model-box {
      background: #09090c !important;
      border: 1px solid #1d1d29 !important;
      padding: 10px !important;
      border-radius: 6px !important;
    }
    
    .swagger-ui .model-title {
      color: #ffffff !important;
    }

    .swagger-ui .model {
      color: #a1a1aa !important;
    }

    .swagger-ui section.models {
      border: 1px solid #1e1e29 !important;
      border-radius: 8px !important;
    }
    
    .swagger-ui section.models h4 {
      color: #ffffff !important;
      border-bottom-color: #1e1e29 !important;
    }
  </style>
</head>
<body>
  <div id="swagger-ui">
    <div class="sentinel-banner">
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <h1>Sentinel Core API Documentation</h1>
          <p>Official OpenAPI v3.1 reference. Connect scanners, extract DNS/WHOIS artifacts, trigger AI analysis pipelines, and poll asynchronous investigator jobs.</p>
        </div>
        <div>
          <span class="mono-badge">V1 GATEWAY ACTIVE</span>
        </div>
      </div>
    </div>
  </div>

  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js" charset="UTF-8"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-standalone-preset.js" charset="UTF-8"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '${openapiSpecUrl}',
        dom_id: '#swagger-ui',
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout",
        deepLinking: true,
        docExpansion: "list"
      });
    };
  </script>
</body>
</html>
`;
}
