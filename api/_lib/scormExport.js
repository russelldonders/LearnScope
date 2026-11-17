import JSZip from 'jszip'

function xmlEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function safeFileName(value) {
  const cleaned = String(value ?? 'learnscope-course')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90)
  return cleaned || 'learnscope-course'
}

function manifestFor(course) {
  const id = `LEARNSCOPE_${course.id.replaceAll('-', '_')}`
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${id}" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG_${id}">
    <organization identifier="ORG_${id}">
      <title>${xmlEscape(course.name)}</title>
      <item identifier="ITEM_${id}" identifierref="RES_${id}" isvisible="true">
        <title>${xmlEscape(course.name)}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES_${id}" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html" />
    </resource>
  </resources>
</manifest>`
}

function launchDocument(course, launchUrl) {
  const config = JSON.stringify({ courseName: course.name, launchUrl }).replaceAll('<', '\\u003c')
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${xmlEscape(course.name)}</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    * { box-sizing: border-box; }
    html, body, iframe { width: 100%; height: 100%; margin: 0; }
    body { background: #f7f7f3; color: #26332c; }
    iframe { display: block; border: 0; background: #fff; }
    #notice { position: fixed; inset: 0; display: grid; place-items: center; padding: 2rem; text-align: center; }
    #notice[hidden] { display: none; }
    #notice p { max-width: 42rem; line-height: 1.5; }
  </style>
</head>
<body>
  <div id="notice" role="status"><p>Opening ${xmlEscape(course.name)} in LearnScope…</p></div>
  <iframe id="learnscope" title="${xmlEscape(course.name)}" allow="fullscreen" hidden></iframe>
  <script>
  (function () {
    'use strict';
    var config = ${config};
    var frame = document.getElementById('learnscope');
    var notice = document.getElementById('notice');
    var api = findApi(window);
    var initialized = api ? api.LMSInitialize('') === 'true' : false;
    var finished = false;

    function findApi(start) {
      var current = start;
      for (var i = 0; i < 20; i += 1) {
        try { if (current.API) return current.API; } catch (e) {}
        try {
          if (!current.parent || current.parent === current) break;
          current = current.parent;
        } catch (e) { break; }
      }
      try { if (window.opener && window.opener.API) return window.opener.API; } catch (e) {}
      return null;
    }

    function getValue(name) {
      if (!initialized) return '';
      try { return api.LMSGetValue(name) || ''; } catch (e) { return ''; }
    }

    function setValue(name, value) {
      if (!initialized || value == null) return;
      try { api.LMSSetValue(name, String(value)); } catch (e) {}
    }

    function commit() {
      if (!initialized) return;
      try { api.LMSCommit(''); } catch (e) {}
    }

    function sendContext() {
      if (!frame.contentWindow) return;
      frame.contentWindow.postMessage({
        type: 'learnscope.scorm.context',
        version: 1,
        learner: {
          id: getValue('cmi.core.student_id'),
          name: getValue('cmi.core.student_name')
        },
        state: {
          status: getValue('cmi.core.lesson_status'),
          score: getValue('cmi.core.score.raw'),
          location: getValue('cmi.core.lesson_location'),
          suspendData: getValue('cmi.suspend_data')
        }
      }, new URL(config.launchUrl).origin);
    }

    window.addEventListener('message', function (event) {
      if (event.source !== frame.contentWindow || event.origin !== new URL(config.launchUrl).origin) return;
      var message = event.data || {};
      if (message.type === 'learnscope.scorm.ready') {
        sendContext();
        return;
      }
      if (message.type !== 'learnscope.scorm.progress' || message.version !== 1) return;
      setValue('cmi.core.lesson_status', message.status);
      setValue('cmi.core.score.raw', message.score);
      setValue('cmi.core.score.min', '0');
      setValue('cmi.core.score.max', '100');
      setValue('cmi.core.lesson_location', message.location);
      setValue('cmi.suspend_data', message.suspendData);
      setValue('cmi.core.exit', message.status === 'completed' || message.status === 'passed' ? '' : 'suspend');
      commit();
    });

    function finish() {
      if (!initialized || finished) return;
      finished = true;
      commit();
      try { api.LMSFinish(''); } catch (e) {}
    }

    window.addEventListener('pagehide', finish);
    window.addEventListener('beforeunload', finish);

    if (initialized && getValue('cmi.core.lesson_status') === 'not attempted') {
      setValue('cmi.core.lesson_status', 'incomplete');
      commit();
    }
    frame.addEventListener('load', sendContext);
    frame.src = config.launchUrl;
    frame.hidden = false;
    notice.hidden = true;
  })();
  </script>
</body>
</html>`
}

export async function buildScormCoursePackage(course, appUrl) {
  if (!course?.id || !course?.name) throw new Error('A course id and name are required.')
  const baseUrl = new URL(appUrl)
  baseUrl.pathname = `/scorm/launch/${course.id}`
  baseUrl.search = ''
  baseUrl.hash = ''

  const zip = new JSZip()
  zip.file('imsmanifest.xml', manifestFor(course))
  zip.file('index.html', launchDocument(course, baseUrl.toString()))
  return {
    buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }),
    fileName: `${safeFileName(course.name)}-SCORM-1.2.zip`,
  }
}
