export const LEAF_REPORT_CSS = `
.exnf-leaf-report{font:14px/1.5 system-ui,sans-serif;color:var(--text-normal,#233042);background:var(--background-primary,#f6f8fb);padding:24px;min-height:100%;box-sizing:border-box}
.exnf-leaf-report *{box-sizing:border-box}
.exnf-leaf-report [hidden]{display:none!important}
.exnf-leaf-report h1{font-size:28px;margin:0 0 8px;letter-spacing:-.5px}
.exnf-leaf-report h2{font-size:17px;margin:8px 0}
.exnf-leaf-report p{margin:8px 0}
.exnf-leaf-report .leaf-context{white-space:pre-wrap;font-size:12px;color:var(--text-muted,#58677b);overflow-wrap:anywhere}
.exnf-leaf-report .leaf-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:18px 0}
.exnf-leaf-report input,.exnf-leaf-report select,.exnf-leaf-report button{font:inherit;padding:7px 10px;border:1px solid var(--background-modifier-border,#bdc8d7);border-radius:6px;background:var(--background-secondary,#fff);color:inherit;height:auto}
.exnf-leaf-report input[type=search]{flex:1;min-width:220px}
.exnf-leaf-report button{cursor:pointer;white-space:normal}
.exnf-leaf-report button:disabled{opacity:.45;cursor:default}
.exnf-leaf-report button[aria-expanded=true]{background:var(--background-modifier-hover,#e5edf9)}
.exnf-leaf-report :focus-visible{outline:3px solid #5b8fd6;outline-offset:2px}
.exnf-leaf-report .leaf-stats{padding:14px 18px;border-left:4px solid #427abe;background:var(--background-secondary,#eaf0f8);border-radius:6px;font-size:16px}
.exnf-leaf-report .leaf-warning{background:var(--background-secondary,#fff2d4);border-left:4px solid #bb842a;padding:10px 14px;margin:12px 0}
.exnf-leaf-report .leaf-groups{border:1px solid var(--background-modifier-border,#d6dfe9);border-radius:8px;overflow:hidden;background:var(--background-secondary,#fff)}
.exnf-leaf-report .leaf-group{border-bottom:1px solid var(--background-modifier-border,#d6dfe9)}
.exnf-leaf-report .leaf-group:last-child{border-bottom:0}
.exnf-leaf-report .leaf-group-toggle{display:flex;justify-content:space-between;gap:16px;text-align:left;width:100%;border:0;border-radius:0;padding:14px 18px;overflow-wrap:anywhere}
.exnf-leaf-report .leaf-rows{padding:0 18px 14px}
.exnf-leaf-report .leaf-row{padding:12px 0;border-top:1px solid var(--background-modifier-border,#e1e7ef);overflow-wrap:anywhere}
.exnf-leaf-report summary{cursor:pointer;font-weight:600}
.exnf-leaf-report .leaf-tags{font-size:12px;color:var(--text-muted,#58677b);margin:4px 0}
.exnf-leaf-report .leaf-note{margin:6px 0;padding:5px 9px;background:var(--background-primary,#f6f8fb);border-radius:4px}
.exnf-leaf-report .leaf-pagination{display:flex;gap:10px;align-items:center;padding:12px 0}
.exnf-leaf-report .leaf-status{min-height:24px;font-size:13px}
.exnf-leaf-report a{color:var(--text-accent,#245f9e)}
@media(max-width:600px){.exnf-leaf-report{padding:14px}.exnf-leaf-report h1{font-size:23px}.exnf-leaf-report .leaf-toolbar{align-items:stretch}.exnf-leaf-report .leaf-toolbar>*{max-width:100%}}
`;
