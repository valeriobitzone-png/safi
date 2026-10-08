/**
 * Shared mount for static mocks: loads the Web Component and wires demo
 * data. All mock pages import this single module.
 */
import "../safi-stamp.js";
import { DEMO_CERTIFICATE, DEMO_STAMP, DEMO_DEVELOPER_CONTEXT } from "../demo-certificate.js";

for (const el of document.querySelectorAll("safi-stamp")) {
  const source = el.hasAttribute("data-source-stamp") ? DEMO_STAMP : DEMO_CERTIFICATE;
  el.source = source;
  if (el.hasAttribute("developer-mode")) {
    el.developerSource = DEMO_DEVELOPER_CONTEXT;
  }
  if (el.hasAttribute("data-microstate")) {
    el.pipelineState = el.getAttribute("data-microstate");
  }
}
