'use strict';

import * as vscode from 'vscode';
import * as request from 'request';
import ElasticSearchResultsProvider from './results-provider';
import url = require('url');

export function activate(context: vscode.ExtensionContext) {
  let resultsProvider = new ElasticSearchResultsProvider();
  const registration = vscode.workspace.registerTextDocumentContentProvider("es-query", resultsProvider);

  context.subscriptions.push(vscode.commands.registerCommand('esQuery.execute', () => {
    const editor = vscode.window.activeTextEditor;
    const selection = editor.selection;

    const range = selection.with(selection.start, selection.end);
    const selectedCode = editor.document.getText(range);
    executeQuery(selectedCode, context, resultsProvider);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('esQuery.setHost', () => {
    setElasticSearchHost(context);
  }));

  context.subscriptions.push(registration);
}

function getLines(code: string):string[] {
  const sanitizedCode: string = code
    .replace(/\r\n/g, "\n")
    .replace(/\n\n/g, "\n")

  return sanitizedCode.split("\n").map((line) => line.trim());
}

async function setElasticSearchHost(context: vscode.ExtensionContext) {
  let options: vscode.InputBoxOptions;

  const host = await vscode.window.showInputBox(<vscode.InputBoxOptions>{
    prompt: "Please enter the ElasticSearch host for this workspace",
    ignoreFocusOut: true,
    value: context.workspaceState.get("esQuery.host", "localhost:9200")
  });

  context.workspaceState.update("esQuery.host", host);
}

interface ElasticSearchQuery {
  method: string,
  path: string,
  body: Object
}

function parseSearchQuery(code: string): ElasticSearchQuery | null {
  const requestReg = /^(GET|POST|DELETE|PUT|OPTIONS|PATCH|HEAD)\s?(\S+)?\s?(HTTP\/\d\.\d+)?$/gim;
  const headerReg = /^([A-Za-z\-]+):(.+)$/gm;

  if (!code.trim()) {
    return null;
  }
  
  let matches = requestReg.exec(code);
  if (matches && matches.length > 1) {
    const method: string = matches[1].toUpperCase();
    const path: string = matches[2] || '';
    const headers = {};
    while ((matches = headerReg.exec(code)) !== null) {
      headers[matches[1]] = matches[2];
    }
    
    const jsonBodyStart: number = code.indexOf('{');
    let body: Object;

    if (jsonBodyStart > -1) {
      try {
        body = JSON.parse(code.substring(jsonBodyStart));
      } catch (e) {
        body = null
      }
    }

    return <ElasticSearchQuery>{ method, path, body };
  }
  return null;
}

async function executeQuery(code:string, context: vscode.ExtensionContext, resultsProvider: ElasticSearchResultsProvider) {
  const lines = getLines(code);
  const host: string = context.workspaceState.get("esQuery.host", null) || await setElasticSearchHost(context);
  const query: ElasticSearchQuery = parseSearchQuery(code);

  if (!query) {
    vscode.window.showErrorMessage("Unable to parse query");
    return;
  }

  const requestUrl: string = url.format({
    host,
    pathname: query.path,
    protocol: 'http'
  })

  request(<request.UrlOptions & request.CoreOptions>{
    url: requestUrl,
    method: query.method,
    json: query.body
  }, (error, response, body) => {
    if (error) {
      vscode.window.showErrorMessage(error.message);
    } else {
      let results = body;
      if (typeof body === "string" && body.startsWith('{')) {
        results = JSON.stringify(JSON.parse(body), null, 2);
      } else if (typeof body === "string" && body.indexOf('\n')) {
        results = results.replace(/\n/g, "\n").replace(/\r/g, "\r");
      } else if (typeof body === "object") {
        results = JSON.stringify(body, null, 2);
      } else {
        results = body;
      }

      resultsProvider.update(results);
      // vscode.commands.executeCommand("vscode.previewHtml", resultsProvider.queryResultsUri, vscode.ViewColumn.Two, 'ElasticSearch Results');
      vscode.workspace.openTextDocument(resultsProvider.queryResultsUri)
        .then(doc =>  vscode.window.showTextDocument(doc, vscode.ViewColumn.Two, true));
    }
  })
}

export function deactivate() {
}