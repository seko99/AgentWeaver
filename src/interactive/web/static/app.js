(function () {
  "use strict";

  var state = {
    viewModel: null,
    connectionState: "connecting",
    formValues: {},
  };

  var elements = {
    title: document.getElementById("app-title"),
    header: document.getElementById("header-text"),
    connection: document.getElementById("connection-state"),
    status: document.getElementById("session-status"),
    run: document.getElementById("run-button"),
    interrupt: document.getElementById("interrupt-button"),
    help: document.getElementById("help-button"),
    flowsTitle: document.getElementById("flows-title"),
    flows: document.getElementById("flows-list"),
    description: document.getElementById("description-text"),
    progressTitle: document.getElementById("progress-title"),
    progress: document.getElementById("progress-text"),
    summaryTitle: document.getElementById("summary-title"),
    summary: document.getElementById("summary-text"),
    logTitle: document.getElementById("log-title"),
    log: document.getElementById("log-text"),
    clearLog: document.getElementById("clear-log-button"),
    helpPanel: document.getElementById("help-panel"),
    helpText: document.getElementById("help-text"),
    closeHelp: document.getElementById("close-help-button"),
    modalRoot: document.getElementById("modal-root"),
  };

  function text(value, fallback) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
    return fallback;
  }

  function actionId() {
    return "web-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function selectedFlow() {
    var vm = state.viewModel;
    if (!vm || !Array.isArray(vm.flowItems)) {
      return null;
    }
    return vm.flowItems[vm.selectedFlowIndex] || null;
  }

  function isFolder(item) {
    if (item && item.kind) {
      return item.kind === "folder";
    }
    var key = String(item && item.key ? item.key : "");
    var label = String(item && item.label ? item.label : "");
    return key.indexOf("folder:") === 0 || key.indexOf("folder/") === 0 || label.trim().endsWith("/");
  }

  function flowMeta(item) {
    var key = String(item && item.key ? item.key : "");
    if (key.indexOf("project") >= 0) return "project";
    if (key.indexOf("global") >= 0) return "global";
    if (key.indexOf("built") >= 0 || key.indexOf("default") >= 0) return "built-in";
    return key;
  }

  var api = {
    socket: null,
    send: function (message) {
      if (!message.actionId) {
        message.actionId = actionId();
      }
      if (!api.socket || api.socket.readyState !== WebSocket.OPEN) {
        appendLog("[web] Cannot send action while disconnected: " + message.type);
        return;
      }
      api.socket.send(JSON.stringify(message));
    },
    connect: function () {
      setConnection("connecting");
      var scheme = window.location.protocol === "https:" ? "wss://" : "ws://";
      api.socket = new WebSocket(scheme + window.location.host + "/__agentweaver/ws");
      api.socket.addEventListener("open", function () {
        setConnection("connected");
      });
      api.socket.addEventListener("close", function () {
        setConnection(state.connectionState === "closed" ? "closed" : "disconnected");
      });
      api.socket.addEventListener("error", function () {
        setConnection("error");
      });
      api.socket.addEventListener("message", function (event) {
        handleServerEvent(event.data);
      });
    },
    selectFlow: function (index, key) {
      api.send({ type: "flow.select", index: index, key: key });
    },
    toggleFolder: function (key) {
      api.send({ type: "folder.toggle", key: key });
    },
    openRunConfirm: function () {
      var flow = selectedFlow();
      api.send({ type: "run.openConfirm", key: flow ? flow.key : undefined });
    },
    selectAndAcceptConfirmation: function (action) {
      if (action === "cancel") {
        api.send({ type: "confirm.cancel" });
        return;
      }
      api.send({ type: "confirm.select", action: action });
      api.send({ type: "confirm.accept" });
    },
    submitForm: function () {
      api.send({ type: "form.submit", values: collectFormValues() });
    },
    cancelForm: function () {
      api.send({ type: "form.cancel" });
    },
    openInterruptConfirm: function () {
      api.send({ type: "interrupt.openConfirm" });
    },
    interruptFlow: function () {
      api.send({ type: "flow.interrupt" });
    },
    clearLog: function () {
      api.send({ type: "log.clear" });
    },
    toggleHelp: function () {
      api.send({ type: "help.toggle", visible: !(state.viewModel && state.viewModel.helpVisible) });
    },
    showHelp: function (visible) {
      api.send({ type: "help.toggle", visible: visible });
    },
    scrollPane: function (pane, offset) {
      api.send({ type: "scroll", pane: pane, offset: offset });
    },
  };

  function setConnection(nextState) {
    state.connectionState = nextState;
    elements.connection.textContent = nextState.charAt(0).toUpperCase() + nextState.slice(1);
    elements.connection.className = "connection connection-" + nextState;
  }

  function handleServerEvent(raw) {
    var message;
    try {
      message = JSON.parse(raw);
    } catch (error) {
      appendLog("[web] Invalid server message: " + error.message);
      return;
    }

    if (message.type === "snapshot") {
      state.viewModel = message.viewModel || {};
      state.formValues = state.viewModel.form ? Object.assign({}, state.viewModel.form.values || {}) : {};
      render();
      return;
    }
    if (message.type === "log.append") {
      appendLog((message.appendedLines || []).join("\n"));
      return;
    }
    if (message.type === "error") {
      appendLog("[web] " + text(message.message, "Unknown protocol error."));
      return;
    }
    if (message.type === "closed") {
      setConnection("closed");
      appendLog("[closed] " + text(message.reason, "Session closed."));
    }
  }

  function appendLog(lines) {
    if (!lines) return;
    var wasPinned = elements.log.scrollTop + elements.log.clientHeight >= elements.log.scrollHeight - 8;
    elements.log.textContent += (elements.log.textContent ? "\n" : "") + lines;
    if (wasPinned) {
      elements.log.scrollTop = elements.log.scrollHeight;
    }
  }

  function render() {
    var vm = state.viewModel || {};
    elements.title.textContent = text(vm.title, "AgentWeaver");
    elements.header.textContent = text(vm.header, "Local operator console");
    elements.status.textContent = text(vm.statusText, "Idle");
    elements.flowsTitle.textContent = text(vm.flowListTitle, "Flows");
    elements.description.textContent = text(vm.descriptionText, "No flow selected.");
    elements.progressTitle.textContent = text(vm.progressTitle, "Progress");
    elements.progress.textContent = text(vm.progressText, "No progress yet.");
    elements.summaryTitle.textContent = text(vm.summaryTitle, "Task Summary");
    elements.summary.textContent = vm.summaryVisible === false ? "Summary is hidden." : text(vm.summaryText, "No task summary yet.");
    elements.logTitle.textContent = text(vm.logTitle, "Activity");
    elements.log.textContent = text(vm.logText, "");
    elements.helpText.textContent = text(vm.helpText, "No help is available.");
    elements.helpPanel.hidden = !vm.helpVisible;
    elements.help.setAttribute("aria-pressed", vm.helpVisible ? "true" : "false");

    renderFlows(vm);
    renderModal(vm);
  }

  function renderFlows(vm) {
    elements.flows.innerHTML = "";
    var items = Array.isArray(vm.flowItems) ? vm.flowItems : [];
    if (items.length === 0) {
      var empty = document.createElement("div");
      empty.className = "flow-meta";
      empty.textContent = "No flows are available.";
      elements.flows.append(empty);
      return;
    }

    items.forEach(function (item, index) {
      var folder = isFolder(item);
      var depth = Number.isFinite(item.depth) ? Math.max(0, item.depth) : 0;
      var row = document.createElement("button");
      row.type = "button";
      row.className = "flow-row" + (folder ? " folder" : "") + (index === vm.selectedFlowIndex ? " selected" : "");
      row.setAttribute("role", folder ? "treeitem" : "option");
      row.style.paddingLeft = String(6 + depth * 18) + "px";
      row.title = item.key || item.label || "";
      row.addEventListener("click", function () {
        if (folder) {
          api.toggleFolder(item.key);
        } else {
          api.selectFlow(index, item.key);
        }
      });
      row.addEventListener("dblclick", function () {
        if (!folder) {
          api.send({ type: "run.openConfirm", key: item.key });
        }
      });

      var icon = document.createElement("span");
      icon.className = "flow-icon";
      icon.textContent = folder ? (item.expanded ? "▾" : "▸") : "•";
      var label = document.createElement("span");
      label.className = "flow-label";
      label.textContent = text(item.name, item.label || item.key || "Untitled flow").replace(/^[\s▸▾•]+/, "");
      var meta = document.createElement("span");
      meta.className = "flow-meta";
      meta.textContent = flowMeta(item);
      row.append(icon, label, meta);
      elements.flows.append(row);
    });
  }

  function renderModal(vm) {
    elements.modalRoot.innerHTML = "";
    if (vm.confirmation) {
      elements.modalRoot.append(renderConfirmation(vm.confirmation));
      return;
    }
    if (vm.confirmText) {
      elements.modalRoot.append(renderConfirmation({
        kind: "run",
        text: vm.confirmText,
        actions: ["ok", "cancel"],
        selectedAction: "ok",
      }));
      return;
    }
    if (vm.form) {
      elements.modalRoot.append(renderForm(vm.form));
    }
  }

  function renderConfirmation(confirmation) {
    var modal = createModal("Confirm " + text(confirmation.kind, "action"), confirmation.text || "");
    var body = modal.querySelector(".modal-body");
    var selected = document.createElement("p");
    selected.className = "modal-note";
    selected.textContent = "Selected action: " + text(confirmation.selectedAction, "none");
    body.append(selected);

    var actions = Array.isArray(confirmation.actions) && confirmation.actions.length > 0 ? confirmation.actions : ["ok", "cancel"];
    var footerActions = modal.querySelector(".modal-actions");
    actions.forEach(function (name) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = name === confirmation.selectedAction ? "primary" : "";
      if (name === "stop") button.className = "danger";
      button.textContent = name === "ok" ? "OK" : name.charAt(0).toUpperCase() + name.slice(1);
      button.addEventListener("click", function () {
        api.selectAndAcceptConfirmation(name);
      });
      footerActions.append(button);
    });
    if (actions.indexOf("cancel") === -1) {
      var cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", function () {
        api.send({ type: "confirm.cancel" });
      });
      footerActions.append(cancel);
    }
    return modal;
  }

  function createModal(title, note) {
    var modal = document.createElement("section");
    modal.className = "modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");

    var header = document.createElement("div");
    header.className = "modal-header";
    var heading = document.createElement("h2");
    heading.textContent = title;
    var paragraph = document.createElement("p");
    paragraph.textContent = note || "";
    header.append(heading, paragraph);

    var body = document.createElement("div");
    body.className = "modal-body";
    var footer = document.createElement("div");
    footer.className = "modal-footer";
    var footerNote = document.createElement("span");
    footerNote.className = "modal-note";
    footerNote.textContent = "";
    var actions = document.createElement("div");
    actions.className = "modal-actions";
    footer.append(footerNote, actions);
    modal.append(header, body, footer);
    return modal;
  }

  function renderForm(formModel) {
    var definition = formModel.definition || {};
    var modal = createModal(text(formModel.title || definition.title, "Input required"), text(definition.description || formModel.content, ""));
    var body = modal.querySelector(".modal-body");
    var footerNote = modal.querySelector(".modal-note");
    var footerActions = modal.querySelector(".modal-actions");

    if (definition.preview) {
      var preview = document.createElement("pre");
      preview.className = "text-panel compact";
      preview.textContent = definition.preview;
      body.append(preview);
    }

    if (formModel.error) {
      var error = document.createElement("div");
      error.className = "error-text";
      error.textContent = formModel.error;
      body.append(error);
    }

    var fields = document.createElement("div");
    fields.className = "form-fields";
    (formModel.fields || definition.fields || []).forEach(function (field) {
      fields.append(renderField(field));
    });
    body.append(fields);

    footerNote.textContent = text(formModel.footer, "");
    var submit = document.createElement("button");
    submit.type = "button";
    submit.className = "primary";
    submit.textContent = text(definition.submitLabel, "Submit");
    submit.addEventListener("click", api.submitForm);
    var cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", api.cancelForm);
    footerActions.append(submit, cancel);
    return modal;
  }

  function currentValue(field) {
    if (Object.prototype.hasOwnProperty.call(state.formValues, field.id)) {
      return state.formValues[field.id];
    }
    if (Object.prototype.hasOwnProperty.call(field, "default")) {
      return field.default;
    }
    if (field.type === "boolean") return false;
    if (field.type === "multi-select") return [];
    if (field.type === "single-select") return field.options && field.options[0] ? field.options[0].value : "";
    return "";
  }

  function renderField(field) {
    var wrapper = document.createElement("div");
    wrapper.className = "field";
    wrapper.dataset.fieldId = field.id;
    wrapper.dataset.fieldType = field.type;

    if (field.type === "boolean") {
      var checkRow = document.createElement("label");
      checkRow.className = "check-row";
      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = currentValue(field) === true;
      checkbox.addEventListener("change", function () {
        updateField(field.id, checkbox.checked);
      });
      checkRow.append(checkbox, document.createTextNode(field.label + (field.required ? " *" : "")));
      wrapper.append(checkRow);
    } else {
      var label = document.createElement("label");
      label.setAttribute("for", "field-" + field.id);
      label.textContent = field.label + (field.required ? " *" : "");
      wrapper.append(label);
      if (field.type === "text") {
        var input = document.createElement(field.multiline ? "textarea" : "input");
        input.id = "field-" + field.id;
        if (!field.multiline) input.type = "text";
        if (field.placeholder) input.placeholder = field.placeholder;
        if (field.rows) input.rows = field.rows;
        input.value = String(currentValue(field) || "");
        input.addEventListener("input", function () {
          updateField(field.id, input.value);
        });
        wrapper.append(input);
      } else if (field.type === "single-select") {
        wrapper.append(renderSingleSelect(field));
      } else if (field.type === "multi-select") {
        wrapper.append(renderMultiSelect(field));
      }
    }

    if (field.help) {
      var help = document.createElement("div");
      help.className = "field-help";
      help.textContent = field.help;
      wrapper.append(help);
    }
    return wrapper;
  }

  function renderSingleSelect(field) {
    var list = document.createElement("div");
    list.className = "option-list";
    var value = String(currentValue(field) || "");
    (field.options || []).forEach(function (option) {
      var label = document.createElement("label");
      label.className = "field-option";
      var input = document.createElement("input");
      input.type = "radio";
      input.name = "field-" + field.id;
      input.value = option.value;
      input.checked = option.value === value;
      input.addEventListener("change", function () {
        if (input.checked) updateField(field.id, option.value);
      });
      var textWrap = document.createElement("span");
      textWrap.append(document.createTextNode(option.label));
      if (option.description) {
        var description = document.createElement("small");
        description.textContent = option.description;
        textWrap.append(document.createElement("br"), description);
      }
      label.append(input, textWrap);
      list.append(label);
    });
    return list;
  }

  function renderMultiSelect(field) {
    var list = document.createElement("div");
    list.className = "option-list";
    var value = currentValue(field);
    var selected = Array.isArray(value) ? value : [];
    (field.options || []).forEach(function (option) {
      var label = document.createElement("label");
      label.className = "field-option";
      var input = document.createElement("input");
      input.type = "checkbox";
      input.value = option.value;
      input.checked = selected.indexOf(option.value) !== -1;
      input.addEventListener("change", function () {
        var next = collectMultiSelect(field.id);
        updateField(field.id, next);
      });
      var textWrap = document.createElement("span");
      textWrap.append(document.createTextNode(option.label));
      if (option.description) {
        var description = document.createElement("small");
        description.textContent = option.description;
        textWrap.append(document.createElement("br"), description);
      }
      label.append(input, textWrap);
      list.append(label);
    });
    return list;
  }

  function updateField(fieldId, value) {
    state.formValues[fieldId] = value;
    api.send({ type: "form.fieldUpdate", fieldId: fieldId, value: value });
  }

  function collectMultiSelect(fieldId) {
    return Array.prototype.slice.call(elements.modalRoot.querySelectorAll('[data-field-id="' + fieldId + '"] input[type="checkbox"]'))
      .filter(function (input) { return input.checked; })
      .map(function (input) { return input.value; });
  }

  function collectFormValues() {
    return Object.assign({}, state.formValues);
  }

  elements.run.addEventListener("click", api.openRunConfirm);
  elements.interrupt.addEventListener("click", api.openInterruptConfirm);
  elements.help.addEventListener("click", api.toggleHelp);
  elements.closeHelp.addEventListener("click", function () {
    api.showHelp(false);
  });
  elements.clearLog.addEventListener("click", api.clearLog);
  elements.progress.addEventListener("scroll", function () {
    api.scrollPane("progress", Math.round(elements.progress.scrollTop));
  });
  elements.summary.addEventListener("scroll", function () {
    api.scrollPane("summary", Math.round(elements.summary.scrollTop));
  });
  elements.log.addEventListener("scroll", function () {
    api.scrollPane("log", Math.round(elements.log.scrollTop));
  });
  elements.helpText.addEventListener("scroll", function () {
    api.scrollPane("help", Math.round(elements.helpText.scrollTop));
  });

  api.connect();
}());
