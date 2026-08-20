function doGet(e) {
  var page = e.parameter ? e.parameter.page : "";
  // WhatsApp verification
  if (e.parameter && e.parameter.challange) {
    return ContentService
      .createTextOutput(e.parameter.challange)
      .setMimeType(ContentService.MimeType.TEXT);
  }

  // 🔐 CRM UI
  if (page === "crm") {

       // validateUser();   // 🔥 BLOCK UNAUTHORIZED USERS

    return HtmlService
      .createHtmlOutputFromFile("IndexAppScript")
      .setTitle("Click2Surat CRM");
  }

  // Website
  return getWebsiteTemplate();
}

function doPost(e) {
        var lock = LockService.getScriptLock();
        lock.waitLock(30000);
        try {
          var body = JSON.parse(e.postData.contents);

          var entry = body.entry && body.entry[0];
          var changes = entry.changes && entry.changes[0];
          var value = changes.value;

          var contact = value.contacts && value.contacts[0];
          var waId = contact.wa_id;
          var rawName = contact.profile && contact.profile.name ? contact.profile.name : "";

          // Check if name is only numbers
          var name = (/^\d+$/.test(rawName)) ? "Unknown" : rawName.trim();

          // Extra safety: if empty after trim
          if (!name) name = "Unknown";

          var message = value.messages && value.messages[0];
          if (!message) {
            return ContentService.createTextOutput(JSON.stringify({ status: "skipped: no message" }))
              .setMimeType(ContentService.MimeType.JSON);
          }

    var messageBody = "";
    var buttonPressed = "";

    // === Handle all message types ===
if (message.type === "text" && message.text?.body) {
  messageBody = message.text.body.trim();
} else if (message.type === "image" && message.image) {
  messageBody = message.image.caption
    ? "[Image] " + message.image.caption.trim()
    : "[Image received]";
} else if (message.type === "video" && message.video) {
  messageBody = message.video.caption
    ? "[Video] " + message.video.caption.trim()
    : "[Video received]";
} else if (message.type === "audio") {
  messageBody = "[Audio message received]";
} else if (message.type === "document") {
  messageBody = "[Document received]";
} else if (message.type === "sticker") {
  messageBody = "[Sticker received]";
} else if (message.type === "location") {
  messageBody = "[Location shared]";
}

    if (message.type === "button" && message.button)
      buttonPressed = message.button.text || message.button.payload || "Unknown Button";

    if (message.type === "interactive" && message.interactive) {
      var interactive = message.interactive;
      if (interactive.type === "button_reply" && interactive.button_reply) {
        buttonPressed = interactive.button_reply.title;
        messageBody = interactive.button_reply.id;
      } else if (interactive.type === "list_reply" && interactive.list_reply) {
        buttonPressed = interactive.list_reply.title;
        messageBody = interactive.list_reply.id;
      }
    }
/*
        if(buttonPressed == "TALK WITH AI")
  {
    triggerSnapServeCall(waId);
  }*/

  if (
  buttonPressed === "TALK WITH AI" ||
  messageBody.trim().toLowerCase() === "api-want more details"
) {
  triggerSnapServeCall(waId);
}

            // === Skip media-only messages (no caption) ===
    if (
      (message.type === "image" && !message.image?.caption) ||
      (message.type === "video" && !message.video?.caption) ||
      message.type === "audio" ||
      message.type === "document" ||
      message.type === "sticker" ||
      message.type === "location"
    ) {
      var timestampStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
      logSkippedMessage(timestampStr, name, waId, messageBody || "[Media only message]", "Media-only message skipped");
      Logger.log("📸 Skipped media-only message from " + waId);
      return ContentService.createTextOutput(JSON.stringify({ status: "skipped_media_message" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    var timestamp = new Date(); // keep as Date object for calculations
    var timestampStr = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

   // === Auto / Negative / Bot detection ===
if (isAutoReplyMessage(
  messageBody,
  waId,
  name,
  buttonPressed,
  message?.interactive?.button_reply?.id
)) {
  return ContentService.createTextOutput(
    JSON.stringify({ status: "skipped: auto/negative/bot" })
  ).setMimeType(ContentService.MimeType.JSON);
}

    var followUpDate = Utilities.formatDate(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // === UniqueContacts sheet ===
    var uniqueSheet = ss.getSheetByName("UniqueContacts");
    if (!uniqueSheet) {
      uniqueSheet = ss.insertSheet("UniqueContacts");
      uniqueSheet.appendRow(["Timestamp", "Name", "Mobile Number", "Another Number", "Employee", "Status", "Product Name", "Follow-up", "Form Link", "Remarks", "", "", "", "Repeated Customer"]);
    }

    //var cleanKey = waId.trim();
    var cleanKey = normalizeNumber(waId);

    var uniqueLastRow = uniqueSheet.getLastRow();
    var existingKeys = new Map(); // store waId → rowIndex
    if (uniqueLastRow > 1) {
      var existingData = uniqueSheet.getRange(2, 3, uniqueLastRow - 1, 1).getValues(); // only waId col C
      existingData.forEach(function(row, idx) {
        //var existingWaId = (row[0] || "").toString().trim();
        var existingWaId = normalizeNumber(row[0]);
        if (existingWaId) {
          existingKeys.set(existingWaId, idx + 2); // actual row index
        }
      });
    }

    // === TypingLeads ===
    var typingSheet = ss.getSheetByName("TypingLeads") || ss.insertSheet("TypingLeads");
    if (typingSheet.getLastRow() === 0)
      typingSheet.appendRow(["Timestamp", "Client Number", "Customer Number", "Keyword", "API Response"]);

      var leadAssign = ss.getSheetByName("LeadAssign") || ss.insertSheet("LeadAssign");
    if (leadAssign.getLastRow() === 0)
      leadAssign.appendRow(["Timestamp", "Employee From", "Employee To", "Customer Number", "API Response"]);

    // === BranchDirectory → Client Numbers ===
    var branchSheet = ss.getSheetByName("EmployeeDirectory");
    var clientNumbers = [];
    if (branchSheet && branchSheet.getLastRow() > 1) {
      clientNumbers = branchSheet.getRange(2, 2, branchSheet.getLastRow() - 1, 1).getValues()
        .map(r => (r[0] || "").toString().trim());
    }
    var apiSheet = ss.getSheetByName("Trigger");
    var isKnownClient = clientNumbers.includes(waId.toString());

// === IF SENDER IS A KNOWN CLIENT ===
    if (isKnownClient) {

      // =====REMARKS==========================================

// 🔹 CLIENT COMMAND: "<customer_number> Remarks"
var remarksCmd = messageBody.match(/(\d{10,15})\s+remark/i);

if (remarksCmd) {
  var customerNumber = remarksCmd[1].replace(/\D/g, "");
  if (/^\d{10}$/.test(customerNumber)) customerNumber = "91" + customerNumber;

  var remarksArr = getLastRemarksArray(customerNumber); // returns array
  var formLink = getFormLinkFromUniqueContacts(customerNumber);
    var existsInUnique = isCustomerInUniqueContacts(customerNumber);

  if (!existsInUnique) {

    var apiUrl2 =
    getAPIUrl("Lead Not Found") +
      //"https://webhooks.whatapi.in/webhook/699c119802e28c7ee4d9c3d9" +
      "?number=" + encodeURIComponent(waId) +
      "&cnumber=" + encodeURIComponent(customerNumber);

    UrlFetchApp.fetch(apiUrl2, { muteHttpExceptions: true });

    return ContentService.createTextOutput(
      JSON.stringify({ status: "customer_not_found_api_triggered" })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  // If no remarks
  if (!remarksArr || remarksArr.length === 0) {
    remarksArr = ["Not Available"];
  }

  // Ensure r1–r5 always exist
  // Always fill missing with "Not Available"
  while (remarksArr.length < 5) {
  remarksArr.push("Not Available");
  }

  // Extract only part AFTER "/" from form link
  var shortFormLink = "Not Available";
  if (formLink && formLink.includes("/")) {
    shortFormLink = formLink.split("/").pop();
  }

  // 🔗 BUILD API URL
  var apiUrl =
    //"https://webhooks.whatapi.in/webhook/699c12d702e28c7ee4d9c5b9" +
    getAPIUrl("Lead Remarks") +
    "?number=" + encodeURIComponent(waId) +
    "&cnumber=" + encodeURIComponent(customerNumber) +
    "&r1=" + encodeURIComponent(remarksArr[0]) +
    "&r2=" + encodeURIComponent(remarksArr[1]) +
    "&r3=" + encodeURIComponent(remarksArr[2]) +
    "&r4=" + encodeURIComponent(remarksArr[3]) +
    "&r5=" + encodeURIComponent(remarksArr[4]) +
    "&flink=" + encodeURIComponent(shortFormLink);

  var resp = UrlFetchApp.fetch(apiUrl, { muteHttpExceptions: true });

  return ContentService.createTextOutput(
    JSON.stringify({ status: "remarks_api_triggered" })
  ).setMimeType(ContentService.MimeType.JSON);
}

// =====Incoming MainLogs==========================================

// 🔹 CLIENT COMMAND: "<customer_number> incoming"
var incomingCmd = messageBody.match(/(\d{10,15})\s+incoming/i);

if (incomingCmd) {

  var customerNumber = incomingCmd[1].replace(/\D/g, "");
  if (customerNumber.length === 10) customerNumber = "91" + customerNumber;

  var messageArr = getLastMessagesFromMainLog(customerNumber);
  var formLink = getFormLinkFromUniqueContacts(customerNumber);
  var existsInMain = isCustomerInMainLogContacts(customerNumber);
  var existsInUnique = isCustomerInUniqueContacts(customerNumber);
  var remarksArr = getLastRemarksArray(customerNumber); // returns array

  if (!existsInMain) {
      if (!existsInUnique)
      {
    var apiUrl11 =
    getAPIUrl("Lead Not Found") +
      //"https://webhooks.whatapi.in/webhook/699c119802e28c7ee4d9c3d9" +
      "?number=" + encodeURIComponent(waId) +
      "&cnumber=" + encodeURIComponent(customerNumber);

          UrlFetchApp.fetch(apiUrl11, { muteHttpExceptions: true });

                return ContentService.createTextOutput(
        JSON.stringify({ status: "not_found_anywhere_api_triggered" })
          ).setMimeType(ContentService.MimeType.JSON);
      }
  else
      {

          // If no remarks
        if (!remarksArr || remarksArr.length === 0) {
          remarksArr = ["Not Available"];
      }

  // Ensure r1–r5 always exist
  // Always fill missing with "Not Available"
        while (remarksArr.length < 5) {
        remarksArr.push("Not Available");
        }

      // Extract only part AFTER "/" from form link
          var shortFormLink = "Not Available";
          if (formLink && formLink.includes("/")) {
          shortFormLink = formLink.split("/").pop();
      }

          var apiUrl2 =
    //"https://webhooks.whatapi.in/webhook/699c12d702e28c7ee4d9c5b9" +
    getAPIUrl("Lead Remarks") +
    "?number=" + encodeURIComponent(waId) +
    "&cnumber=" + encodeURIComponent(customerNumber) +
    "&r1=" + encodeURIComponent(remarksArr[0]) +
    "&r2=" + encodeURIComponent(remarksArr[1]) +
    "&r3=" + encodeURIComponent(remarksArr[2]) +
    "&r4=" + encodeURIComponent(remarksArr[3]) +
    "&r5=" + encodeURIComponent(remarksArr[4]) +
    "&flink=" + encodeURIComponent(shortFormLink);

        UrlFetchApp.fetch(apiUrl2, { muteHttpExceptions: true });
      return ContentService.createTextOutput(
      JSON.stringify({ status: "customer_not_found_api_triggered" })
    ).setMimeType(ContentService.MimeType.JSON);
      }
  }

  if (!messageArr || messageArr.length === 0) {
    messageArr = ["Not Available"];
  }

  while (messageArr.length < 5) {
    messageArr.push("Not Available");
  }

    // Extract only part AFTER "/" from form link
  var shortFormLink = "Not Available";
  if (formLink && formLink.includes("/")) {
    shortFormLink = formLink.split("/").pop();
  }
      
  var apiUrl =
    //"https://webhooks.whatapi.in/webhook/699c12d702e28c7ee4d9c5b9" +
    getAPIUrl("Lead Remarks") +
    "?number=" + encodeURIComponent(waId) +
    "&cnumber=" + encodeURIComponent(customerNumber) +
    "&r1=" + encodeURIComponent(messageArr[0]) +
    "&r2=" + encodeURIComponent(messageArr[1]) +
    "&r3=" + encodeURIComponent(messageArr[2]) +
    "&r4=" + encodeURIComponent(messageArr[3]) +
    "&r5=" + encodeURIComponent(messageArr[4]) +
    "&flink=" + encodeURIComponent(shortFormLink);

  UrlFetchApp.fetch(apiUrl, { muteHttpExceptions: true });

  return ContentService.createTextOutput(
    JSON.stringify({ status: "incoming_api_triggered" })
  ).setMimeType(ContentService.MimeType.JSON);
}

// ===============Assign to Employee=======================
// 🔹 CLIENT COMMAND: "<number> to <employee>"
var assignCmd = messageBody.match(/(\d{10,15})\s+to\s+(.+)/i);

if (assignCmd) {

  var customerNumber = assignCmd[1].replace(/\D/g, "");
  if (customerNumber.length === 10) customerNumber = "91" + customerNumber;

  var employeeNameInput = assignCmd[2].trim();

  var assignedEmployee = assignEmployeeToCustomer(customerNumber, employeeNameInput);

  if (!assignedEmployee) {
    return ContentService.createTextOutput(
      JSON.stringify({ status: "employee_not_found_or_customer_not_found" })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  var employeePhone = getEmployeePhone(assignedEmployee);
  
   // 🔹 Regenerate updated form link (with new employee name)
  var tinyLink = updateSingleFormLink(customerNumber);

  var shortFormLink = "Not Available";
  if (tinyLink && tinyLink.includes("/")) {
    shortFormLink = tinyLink.split("/").pop();
  }

  // 🔗 Trigger WhatsApp API TO EMPLOYEE
  var apiUrl =
    //"https://webhooks.whatapi.in/webhook/699c10ea02e28c7ee4d9c216" +
    getAPIUrl("Lead Assigned") +
    "?enumber=" + encodeURIComponent(employeePhone) +
    "&cnumber=" + encodeURIComponent(customerNumber) +
    "&ename=" + encodeURIComponent(assignedEmployee) +
    "&assignedby=" + encodeURIComponent(waId) +
    "&flink=" + encodeURIComponent(shortFormLink);
    

              var apiResponse = "";

              if (apiUrl) {
                try {

                  var resp = UrlFetchApp.fetch(apiUrl, {
                    muteHttpExceptions: true
                  });

                  apiResponse = resp.getContentText();
                  Logger.log("📡 API triggered: " + apiUrl);
                  Logger.log("📩 API Response: " + apiResponse);

                } catch (err) {

                  apiResponse = "API Error: " + err.message;
                  Logger.log("❌ " + apiResponse);

                }
              } else {
                apiResponse = "⚠️ No API found for keyword.";
              }

//  AllSheetLeadsUpdate();

            // ✅ Log to Typing sheet only
          leadAssign.insertRows(2, 1);
          leadAssign.getRange(2, 1, 1, 5)
            .setValues([[timestampStr, waId, employeePhone, customerNumber, apiResponse]]);
          Logger.log("✍️ Added in Typing: " + customerNumber);

  return ContentService.createTextOutput(
    JSON.stringify({ status: "employee_assigned_and_notified" })
  ).setMimeType(ContentService.MimeType.JSON);
}

// ===============Delete=======================
// 🔹 CLIENT COMMAND: "<number> to <employee>"
var deleteCmd = messageBody.match(/(\d{10,15})\s+delete/i);

if (deleteCmd) {

  var customerNumber = deleteCmd[1].replace(/\D/g, "");
  if (customerNumber.length === 10) customerNumber = "91" + customerNumber;

  var deleted = deleteCustomerEverywhere(customerNumber);

  // AllSheetLeadsUpdate();

        if (!deleted) {
          return ContentService.createTextOutput(
            JSON.stringify({ status: "customer_not_found" })
          ).setMimeType(ContentService.MimeType.JSON);
        }

        return ContentService.createTextOutput(
          JSON.stringify({ status: "customer_deleted_successfully" })
        ).setMimeType(ContentService.MimeType.JSON);
  }

  // ================= MASTER DATA REFRESH =================
if (messageBody.trim().toLowerCase() === "referesh") {

  syncMasterData();

  return ContentService.createTextOutput(
    JSON.stringify({
      status: "master_data_refreshed"
    })
  ).setMimeType(ContentService.MimeType.JSON);
}

// =============== Remove Repeated Customer =======================
// Command: <customer_number> RR

var rrCmd = messageBody.match(/(\d{10,15})\s+rr/i);

if (rrCmd) {

  var customerNumber = rrCmd[1].replace(/\D/g, "");

  if (customerNumber.length === 10) {
    customerNumber = "91" + customerNumber;
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName("UniqueContacts");

  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {

    var mobile = (data[i][2] || "").toString().replace(/\D/g, "");

    if (mobile.length === 10) mobile = "91" + mobile;

    if (mobile === customerNumber) {

      // Clear Column N (Repeated Customer)
      sheet.getRange(i + 1, 14).clearContent();

      return ContentService.createTextOutput(
        JSON.stringify({
          status: "repeated_customer_removed"
        })
      ).setMimeType(ContentService.MimeType.JSON);
    }
  }

  return ContentService.createTextOutput(
    JSON.stringify({
      status: "customer_not_found"
    })
  ).setMimeType(ContentService.MimeType.JSON);
}
// ===============================================

      var messageNumberMatch = messageBody.match(/\d{10,15}/);
      if (messageNumberMatch) {
        var messageNumber = messageNumberMatch[0].replace(/\D/g, "");
        var finalNumber = /^\d{10}$/.test(messageNumber)
          ? "91" + messageNumber
          : /^91\d{10}$/.test(messageNumber)
            ? messageNumber
            : null;

        if (finalNumber) {
          var foundKeyword = "";
          var apiUrl = "";
          var vars = {}; // store var1...var6


            // ================= AI CALL TRIGGER =================
            if (/\bai\b/i.test(messageBody)) {

              var result = triggerSnapServeCall(finalNumber);

              // Log into TypingLeads
              typingSheet.insertRows(2, 1);
              typingSheet.getRange(2, 1, 1, 5).setValues([[
                timestampStr,
                waId,               // Employee Number
                finalNumber,        // Customer Number
                "AI",
                 result.response
              ]]);

              return ContentService
                .createTextOutput(JSON.stringify({
                  status: "ai_call_triggered",
                  customer: finalNumber
                }))
                .setMimeType(ContentService.MimeType.JSON);
            }
            // ===================================================


          if (apiSheet) {
            var apiData = apiSheet.getRange(2, 1, apiSheet.getLastRow() - 1, 16).getValues();
            var lowerMsg = messageBody.toLowerCase();

            for (var i = 0; i < apiData.length; i++) {
              var keyword = (apiData[i][1] || "").toString().trim().toLowerCase();
              var url = (apiData[i][2] || "").toString().trim();
              if (keyword && lowerMsg.includes(keyword)) {
                foundKeyword = keyword;
                apiUrl = url;

                // Auto Read Variables (var0, var1, var2.....)
                for (var c = 3; c < apiData[i].length; c++) {

                  var value = apiData[i][c];

                  if (value !== "" && value != null) {
                    vars["var" + (c - 3)] = value;
                  }

                }

                break;           
              }
            }
          }
          
          var apiResponse = "";
          if (apiUrl) {
            try {
                        // build dynamic query string
                        var query = "?number=" + encodeURIComponent(finalNumber);

                        Object.keys(vars).forEach(k => {
                        if (vars[k] !== "") {
                        query += "&" + k + "=" + encodeURIComponent(vars[k]);
                        }
                          });

              var fullUrl = apiUrl + query;
              var resp = UrlFetchApp.fetch(fullUrl, { muteHttpExceptions: true });
              apiResponse = resp.getContentText();
              Logger.log("📡 API triggered: " + fullUrl);
            } catch (err) {
              apiResponse = "API Error: " + err.message;
              Logger.log("❌ " + apiResponse);
            }
          } else {
            apiResponse = "⚠️ No API found for keyword.";
          }

          // ✅ Log to Typing sheet only
          typingSheet.insertRows(2, 1);
          typingSheet.getRange(2, 1, 1, 5)
            .setValues([[timestampStr, waId, finalNumber, foundKeyword || "default", apiResponse]]);
          Logger.log("✍️ Added in Typing: " + finalNumber);

          // ❌ Do NOT log to MainLog or UniqueContacts
          return ContentService.createTextOutput(JSON.stringify({ status: "typed_to_Typing" }))
            .setMimeType(ContentService.MimeType.JSON);
        }
      }

      Logger.log("ℹ️ Client message ignored (no valid number).");
      return ContentService.createTextOutput(JSON.stringify({ status: "client_message_skipped" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    //=====================================================================

    // === Skip employee numbers ===
    if (typeof employeeNumbers !== "undefined" && employeeNumbers.includes(cleanKey)) {
      Logger.log("ℹ️ Skipped adding to UniqueContacts — employee number: " + cleanKey);
      return ContentService.createTextOutput(JSON.stringify({ status: "skipped: employee number" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // === Log main message ===
    var logSheet = ss.getSheetByName("MainLog") || ss.insertSheet("MainLog");
    if (logSheet.getLastRow() === 0)
      logSheet.appendRow(["Timestamp", "Name", "WhatsApp ID", "Message Body", "Button Pressed", "Lead Status"]);

    var leadStatus = existingKeys.has(cleanKey) ? "Lead is Exist" : "New Lead Added";
    //logSheet.appendRow([timestampStr, name, waId, messageBody, buttonPressed, leadStatus]);

     // ✅ Always log to MainLog
    logSheet.insertRows(2, 1);
    logSheet.getRange(2, 1, 1, 6)
      .setValues([[timestampStr, name, waId, messageBody, buttonPressed, leadStatus]]);

    // === Add new lead ===
    if (!existingKeys.has(cleanKey)) {
      var statusLead = "New";
      //var employee = "Unassigned";
      var amobile = "";
      //var product = "";
      var broker = "";
      var serial = "";
      var clientBudget= "";
      var clientInfo = "";      

      // ✅ Assign branch correctly
      var messageText = (buttonPressed || messageBody || "").toString();
      var employee = getEmployeeFromMessage(messageText) || "Unassigned";
      var product = "";   // or set default product if needed


      var prefilledLink = generatePrefilledFormLink(name, waId, amobile, employee, statusLead, product);
      var tinyLink = shortenUrlTiny(prefilledLink);

      uniqueSheet.insertRows(2, 1);
      uniqueSheet.getRange(2, 1, 1, 14)
          .setValues([[
          timestampStr,
          name,
          waId,
          amobile,
          employee,
          statusLead,
          product,              // Product Name
          followUpDate,    // Follow-up
          tinyLink,   // Form Link
          "",              // Remarks
          "", "", "", ""   // filler cols until N
          ]]);
      triggerWhatsAppURL(waId, name, statusLead);
      // AllSheetLeadsUpdate();

    } else {
      // === Existing Lead: Mark Repeated ===
      var rowIndex = existingKeys.get(cleanKey);
      var firstTimestamp = new Date(uniqueSheet.getRange(rowIndex, 1).getValue());
      var diffDays = (timestamp - firstTimestamp) / (1000 * 60 * 60 * 24);
      var repeatLead = "Repeated Customer";

      var cell = uniqueSheet.getRange(rowIndex, 14);
      var currentValue = cell.getValue();

      if (diffDays >= 1 && currentValue !== "Repeated Customer") {
        cell.setValue("Repeated Customer");
        cell.setFontColor("red");
        triggerWhatsAppURL(waId, name, repeatLead);
      //  AllSheetLeadsUpdate();
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ error: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  finally {
  lock.releaseLock(); // 🔥 ALWAYS release
}
}

function getAPIUrl(statusName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName("StatusAPIMap");

  const data = sheet.getRange(1, 1, sheet.getLastRow(), 2).getValues();

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === statusName) {
      return String(data[i][1]).trim();
    }
  }

  throw new Error("API URL not found for: " + statusName);
}

function normalizeNumber(num) {
  return (num || "")
    .toString()
    .replace(/\D/g, "")     // remove non-digits
    .replace(/^91/, "");    // remove country code
}

function getEmployeeFromMessage(msg) {
  if (!msg) return "Unassigned";

  // Normalize input
  var cleanMsg = msg.toString().toLowerCase()
    .replace(/\u00A0/g, "")       // non-breaking spaces
    .replace(/[\s\-\_]+/g, "")    // spaces, hyphens, underscores
    .replace(/[^\w]/g, "");       // remove punctuation

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var empSheet = ss.getSheetByName("EmployeeDirectory");
  var lastRow = empSheet.getLastRow();
  if (lastRow < 2) return "Unassigned";

  var data = empSheet.getRange(2, 1, lastRow - 1, 5).getValues();

  for (var i = 0; i < data.length; i++) {
    var employeeName = data[i][0];
    var keywords = (data[i][3] || "").toString().toLowerCase();

    if (!keywords) continue;

    var keywordList = keywords.split(",").map(function(k) {
      return k.trim()
        .replace(/\u00A0/g, "")
        .replace(/[\s\-\_]+/g, "")
        .replace(/[^\w]/g, "");
    });

    for (var j = 0; j < keywordList.length; j++) {
      if (keywordList[j] && keywordList[j].length > 3 && cleanMsg.includes(keywordList[j])) {
        return employeeName;
      }
    }
  }
  return "Unassigned";
}

// 📝 Skipped messages log
function logSkippedMessage(timestamp, name, waId, messageBody, reason) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("SkippedMessages");

  if (!sheet) {
    sheet = ss.insertSheet("SkippedMessages");
    sheet.appendRow(["Timestamp", "Name", "Mobile Number", "Message", "Reason"]);
  }

  // ➕ Insert new row below header (Row 2)
  sheet.insertRowBefore(2);

  // ✍️ Write data in row 2
  sheet.getRange(2, 1, 1, 5).setValues([[
    timestamp,
    name,
    waId,
    messageBody,
    reason
  ]]);
}

function handleEdit(e) {
  var sheet = e.range.getSheet();
  var sheetName = "UniqueContacts";

  // Only act in UniqueContacts
  if (sheet.getName() !== sheetName) return;

  var row = e.range.getRow();
  if (row < 2) return; // skip header

  var col = e.range.getColumn();

    // ✅ ONLY trigger when Employee (5) or Status (6) changes
  if (col !== 5 && col !== 6) return;

    var name = sheet.getRange(row, 2).getValue();       // WhatsApp Name
    var waId = sheet.getRange(row, 3).getValue();       // WhatsApp ID
    var amobile = sheet.getRange(row,4).getValue();
    var employee = sheet.getRange(row, 5).getValue();     // Branch
    var status = sheet.getRange(row, 6).getValue();     // Status
    var product = sheet.getRange(row, 7).getValue();    // Product Name

    // Only if key fields exist
    if (name && waId && employee && status) {
      var prefilledLink = generatePrefilledFormLink(name, waId, amobile, employee, status, product);

       // ✅ Convert to tiny link
      var tinyLink = shortenUrlTiny(prefilledLink);
      // var tinyLink = shortenUrl(prefilledLink);       

      // ✅ Write back to Form Link column (I)
      sheet.getRange(row, 9).setValue(tinyLink);

     // removeFromTodaysLeads(waId);                
      //AllSheetLeadsUpdate();
    }  
}

// Fetching Employee Details
function getEmployeePhoneNumber(employeeName) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("EmployeeDirectory");
  if (!sheet) return "";

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0].toString().trim().toLowerCase() === employeeName.trim().toLowerCase()) {
      return data[i][1]; // phone number
    }
  }
  return "";
}

function generatePrefilledFormLink(name, mobile, amobile, employee, status, product) {

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var apiSheet = ss.getSheetByName("StatusAPIMap");
  var formBaseURL = apiSheet.getRange(2, 2).getValue();

  //var formBaseURL = "https://docs.google.com/forms/d/e/1FAIpQLScqfYF6fnh4pA12P43k6KK7b-n8enmzpYmyVBeVRt67TIvRLQ/viewform?usp=pp_url"; // Replace FORM_ID

  // Replace these with your actual entry IDs
  var params = [
    "entry.1093412999=" + encodeURIComponent(name),
    "entry.342397579=" + encodeURIComponent(mobile),
    "entry.1459851024=" + encodeURIComponent(amobile),
    "entry.1024777510=" + encodeURIComponent(employee),
    "entry.1004805408=" + encodeURIComponent(status)
  ];

   // Support multiple products (for checkboxes)
  if (product) {
    var productOptions = product.split(",").map(p => p.trim());
    productOptions.forEach(function(p) {
      params.push("entry.531164685=" + encodeURIComponent(p));
    });
  }

   var fullURL = formBaseURL + "&" + params.join("&");
    return shortenUrlTiny(fullURL); // 🔗 Use shortener
}

function shortenUrlTiny(longUrl) {
  try {
    var response = UrlFetchApp.fetch("https://tinyurl.com/api-create.php?url=" + encodeURIComponent(longUrl));
    return response.getContentText();
  } catch (error) {
    Logger.log("URL shortening failed: " + error.message);
    return longUrl; // fallback to original if failed
  }
}


function updateFormLinks() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("UniqueContacts");
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    var name = data[i][1];
    var mobile = data[i][2];
    var amobile = data[i][3];
    var employee = data[i][4];
    var status = data[i][5];
    var product = data[i][6];
    var link = generatePrefilledFormLink(name, mobile, amobile, employee, status, product);
    sheet.getRange(i + 1, 9).setValue(link); // Column H = Form Link
  }
}

function getStatusApiMap() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("StatusAPIMap");
  if (!sheet) return {};

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues(); // Skip header
  var map = {};

  data.forEach(function(row) {
    var status = row[0]?.toString().trim();
    var apiUrl = row[1]?.toString().trim();
    var var1 = row[2]?.toString().trim();
    var var2 = row[3]?.toString().trim();
    var var3 = row[4]?.toString().trim();
    var var4 = row[5]?.toString().trim();
    if (status && apiUrl) {
      map[status] = {
      apiUrl,
      var1,
      var2,
      var3,
      var4
      };
    }
  });

  return map;
}

//===========================================================
function onFormSubmit(e) {
  var responses = e.values;

  var name = responses[1];        // Name
  var mobile = responses[2];      // Mobile Number
  var status = responses[6];      // Status
  var product = responses[5];     // Product Name
  var followUpRaw = responses[7]; // Follow-up (Date + Time)
  var remarks = responses[8];     // Remarks
  var amobile = responses[3];
  var employee = responses[4];

  // Format Follow-up as "yyyy-MM-dd HH:mm"
  var followUpFormatted = followUpRaw;
  if (followUpRaw instanceof Date) {
    followUpFormatted = Utilities.formatDate(
      new Date(followUpRaw),
      Session.getScriptTimeZone(),
      "yyyy-MM-dd HH:mm"
    );
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("UniqueContacts");
  var data = sheet.getDataRange().getValues();
  var found = false;

  for (var i = 1; i < data.length; i++) {
    function cleanNumber(num){
  return num.toString().replace(/\D/g,"").replace(/^91/,"");
}
    if (cleanNumber(data[i][2]) === cleanNumber(mobile)) {
      found = true;

      sheet.getRange(i + 1, 2).setValue(name);
      sheet.getRange(i + 1, 4).setValue(amobile);
      sheet.getRange(i + 1, 5).setValue(employee);
      sheet.getRange(i + 1, 6).setValue(status);              // Status (Column E)
      sheet.getRange(i + 1, 7).setValue(product);             // Product (Column F)
      sheet.getRange(i + 1, 8).setValue(followUpFormatted);   // Follow-up (Column G)
      sheet.getRange(i + 1, 10).setValue(remarks);             // Remarks (Column I)

      var link = generatePrefilledFormLink(name, mobile, amobile, employee, status, product);
      sheet.getRange(i + 1, 9).setValue(link);                // Form Link (Column H)

      //sheet.getRange(i + 1, 1, 1, 10).setBackground(null);     // Remove background color
      // 🔄 Clear Customer and Employee Reminder ticks
          sheet.getRange(i + 1, 11).setValue(""); // Customer Reminder Sent (Column J)
          sheet.getRange(i + 1, 12).setValue(""); // Employee Reminder Sent (Column K)
          sheet.getRange(i + 1, 13).setValue(""); // Employee Reminder Sent (Column L)
          sheet.getRange(i + 1, 14).setValue(""); // Employee Reminder Sent (Column M)

          // ✅ Ensure followUpFormatted always has a value
              if (!followUpFormatted || followUpFormatted.toString().trim() === "") {
                    followUpFormatted = "NA";   // or "2099-12-31 23:59" or "No Follow-up"
            }

      // ✅ Trigger WhatsApp message
      var statusApiMap = getStatusApiMap();
      if (statusApiMap[status]) {
        sendToBothNumbers(mobile, amobile, function (num) {
        triggerWhatsAppByStatus(num, name, status, product, followUpFormatted, statusApiMap[status]);
        });
      }

      //removeFromTodaysLeads(mobile); // ⛔ Remove from TodaysLeads.gs      
      //AllSheetLeadsUpdate();

      break;
    }
  }

  // ✅ Add new lead if not found
  if (!found) {
    var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    //var employee = "Unassigned";
    var formLink = generatePrefilledFormLink(name, mobile, amobile, employee, status, product);

 sheet.insertRows(2, 1);
      sheet.getRange(2, 1, 1, 10)
      .setValues([[
    timestamp,
    name,
    mobile,
    amobile,
    employee,
    status,
    product,
    followUpFormatted,
    formLink,
    remarks
    ]]);

                     // ✅ Ensure followUpFormatted always has a value
              if (!followUpFormatted || followUpFormatted.toString().trim() === "") {
                    followUpFormatted = "NA";   // or "2099-12-31 23:59" or "No Follow-up"
            }

          // ✅ Trigger WhatsApp message
      var statusApiMap = getStatusApiMap();
      if (statusApiMap[status]) {
        sendToBothNumbers(mobile, amobile, function (num) {
        triggerWhatsAppByStatus(num, name, status, product, followUpFormatted, statusApiMap[status]);
        });
      }

      //AllSheetLeadsUpdate();

    Logger.log("New lead added: " + name + " / " + mobile);
  }

  // === 🧾 Log Lead-wise Remarks in FollowUpHistory (One row per lead, multiple remarks in columns) ===
  var historySheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("FollowUpHistory");
  if (!historySheet) {
    historySheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet("FollowUpHistory");
    historySheet.appendRow(["Name", "Mobile", "Another Mobile", "Remarks 1"]);
  }

  //var nameTrimmed = name.toString().trim().toLowerCase();
  var mobileDigits = mobile.toString().replace(/\D/g, '');

  var historyData = historySheet.getDataRange().getValues();
  var foundRow = -1;

  for (var r = 1; r < historyData.length; r++) {
    //var existingName = (historyData[r][0] || "").toString().trim().toLowerCase();
    var existingMobile = (historyData[r][1] || "").toString().replace(/\D/g, '');
    if (existingMobile === mobileDigits) {
      foundRow = r + 1;
      break;
    }
  }
/*
  // Get Employee Name
  var employeeName = "";
  for (var i = 1; i < data.length; i++) {
    //var existingName = (data[i][1] || "").toString().trim().toLowerCase();
    var existingMobile = (data[i][2] || "").toString().replace(/\D/g, '');
    if (existingMobile === mobileDigits) {
     // employeeName = data[i][3] || "Unknown";
      employeeName = (data[i][4] && data[i][4].toString().trim()) ? data[i][4] : "Unassigned";
      break;
    }
  }
*/
  // ✅ Use employee value directly from form submission
var employeeName = (employee && employee.toString().trim()) ? employee : "Unassigned";

  var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd-MM-yyyy HH:mm");
  var formattedRemark = timestamp + " ➤ [" + employeeName + "] ➤ [" + product + "] ➤ (" + status + ") → " + remarks;

  if (foundRow !== -1) {
// ✅ Update name if changed
  historySheet.getRange(foundRow, 1).setValue(name);

            // ✅ Update Another Mobile ONLY if new value exists
          if (amobile && amobile.toString().trim() !== "") {
            historySheet.getRange(foundRow, 3).setValue(amobile);
          }

        // 🔒 Remarks always start from column D (index 4)
            var lastCol = historySheet.getLastColumn();
            var rowValues = historySheet
          .getRange(foundRow, 4, 1, lastCol - 3)
          .getValues()[0];

            var emptyCol = rowValues.findIndex(cell => !cell);

            if (emptyCol === -1) {
              var newColIndex = lastCol + 1;
              historySheet.insertColumnAfter(lastCol);
              historySheet.getRange(1, newColIndex).setValue("Remarks " + (newColIndex - 3));
              historySheet.getRange(foundRow, newColIndex).setValue(formattedRemark);
            } else {
              historySheet.getRange(foundRow, emptyCol + 4).setValue(formattedRemark);
            }

          } else {
            historySheet.appendRow([name, mobile, amobile, formattedRemark]);
          }
}


//==========================================================

function formatDateForReminder(date) {
  return Utilities.formatDate(date, "Asia/Kolkata", "dd-MM-yyyy hh:mm a");
}

function sendToBothNumbers(primary, secondary, callback) {
  var numbers = [];

  if (primary && primary.toString().trim() !== "") {
    numbers.push(primary.toString().trim());
  }
  if (secondary && secondary.toString().trim() !== "") {
    numbers.push(secondary.toString().trim());
  }

  numbers.forEach(function(num) {
    try {
      callback(num);
      Logger.log("✅ Reminder sent to: " + num);
    } catch (e) {
      Logger.log("❌ Failed for " + num + " : " + e);
    }
  });
}

//==========================================================

function processFollowUpReminders() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("UniqueContacts");
  if (!sheet) return;

  var now = new Date();
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;

  var headers = data[0];

  // 🔹 Column Index Setup
  var mobileCol = headers.indexOf("WhatsApp ID");
  var amobileCol = headers.indexOf("Another Number");
  var nameCol = headers.indexOf("WhatsApp Name");
  var employeeCol = headers.indexOf("Employee") !== -1 ? headers.indexOf("Employee") : headers.indexOf("Branch");
  var statusCol = headers.indexOf("Status");
  var productCol = headers.indexOf("Product Name") !== -1 ? headers.indexOf("Product Name") : headers.indexOf("Client Budget");
  var followUpCol = headers.indexOf("Follow-up");
  var formLinkCol = headers.indexOf("Form Link");
  var customerTickCol = headers.indexOf("Customer Reminder Sent");
  var employeeTickCol = headers.indexOf("Employee Reminder Sent");
  var employeeOTickCal = headers.indexOf("Overdue Reminder Sent");

  // 🚀 OPTIMIZATION: Only scan the most recent 200 leads to prevent 6-minute timeouts!
  var startRow = Math.max(1, data.length - 200);

  for (var i = startRow; i < data.length; i++) {
    var row = data[i];
    var followUp = row[followUpCol];
    if (!(followUp instanceof Date)) continue;

    var followUpDate = new Date(followUp);
    var diffMs = followUpDate - now;
    var diffMin = diffMs / (1000 * 60);

    var name = row[nameCol];
    var mobile = row[mobileCol];
    var amobile = row[amobileCol];
    var employee = row[employeeCol];
    var status = row[statusCol];
    var product = row[productCol];
    var formLink = row[formLinkCol];
    var customerTick = row[customerTickCol];
    var employeeTick = row[employeeTickCol];
    var employeeOTick = row[employeeOTickCal];
    var formattedFollowUp = formatDateForReminder(followUpDate);

    // ✅ Customer Reminder: 45 min before
    if (!customerTick && Math.abs(diffMin - 45) <= 3 && followUpDate > now) {
      if (!["New", "Not Interested", "Converted", "Follow-Up (Hot Lead)","STOP"].includes(status)) {
        sendToBothNumbers(mobile, amobile, function (num) {
          triggerWhatsAppReminderToCustomer1(num, name, status, product, formattedFollowUp, "Follow-up Reminder");
          var mobileWithout91 = num.toString().replace(/^91/, '');
          triggerVoiceCallToCustomer(mobileWithout91);
          triggerSMSToCustomer(mobileWithout91, name, formattedFollowUp);
        });
        sheet.getRange(i + 1, customerTickCol + 1).setValue("🔴");
      }
    }

    // ✅ Customer Reminder: 15 min before
    if (customerTick === "🔴" && Math.abs(diffMin - 15) <= 3 && followUpDate > now) {
      if (!["New", "Not Interested", "Converted", "Follow-Up (Hot Lead)","STOP"].includes(status)) {
        sendToBothNumbers(mobile, amobile, function (num) {
          triggerWhatsAppReminderToCustomer2(num, name, status, product, formattedFollowUp, "Follow-up Reminder");
          var mobileWithout91 = num.toString().replace(/^91/, '');
          triggerVoiceCallToCustomer(mobileWithout91);
          triggerSMSToCustomer(mobileWithout91, name, formattedFollowUp);
        });
        sheet.getRange(i + 1, customerTickCol + 1).setValue("🔴🔴");
      }
    }

    // ✅ Employee Reminder: 15 min before
    if (!employeeTick && Math.abs(diffMin - 15) <= 3 && followUpDate > now) {
      if (!["New","Not Interested", "Converted"].includes(status)) {
        var employeeNumber = getEmployeePhoneNumber(employee);
        if (employeeNumber) {
          triggerWhatsAppReminderToEmployee(employeeNumber, name, mobile, employee, status, product, formattedFollowUp, formLink, "Follow-up Reminder");
          sheet.getRange(i + 1, employeeTickCol + 1).setValue("🔴");
        }
      }
    }

    // ==================================================
    // 🔴 OVERDUE FOLLOW-UPS (Follow-up < now)
    // ==================================================
    if (followUpDate < now && !["New","Not Interested", "Converted"].includes(status)) {
      var employeeNumber = getEmployeePhoneNumber(employee);

      // First overdue reminder
      if (!employeeOTick) {
        if (employeeNumber) {
          triggerWhatsAppReminderToEmployee(employeeNumber, name, mobile, employee, status, product, formattedFollowUp, formLink, "Overdue Reminder");
          sheet.getRange(i + 1, employeeOTickCal + 1).setValue("🔴");
        }
      }
    }
  }
}


function triggerSnapServeCall(toNumber) {
  var API_KEY = "sk_live_f293f23aa522368b25cfe46d19935109e1bacbbba373ea664c18a5df0d0742e8";
  var AGENT_ID = 261;
  var WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbxza6mrqC1VUJTrNufXtWQwD4cFquu7VTprwJCk_6DqLOEHWuxqcOj5Kp93-c7_ERP6/exec";

  toNumber = String(toNumber).replace(/\D/g, "");

  if (toNumber.length === 10)
    toNumber = "91" + toNumber;

  var payload = {
    agentId: AGENT_ID,
    toNumber: toNumber
  };

  var options = {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + API_KEY
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(
      "https://app.snapserve.ai/api/calls/outbound",
      options
    );

    var code = response.getResponseCode();
    var text = response.getContentText();

    Logger.log(code);
    Logger.log(text);

    var result = {};

    try {
      result = JSON.parse(text);
    } catch (e) {
      result = {
        raw: text
      };
    }

    // ===== Save to Calls Sheet =====
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Calls");

    if (!sheet) {
      sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet("Calls");

      sheet.appendRow([
        "Mobile",
        "Call ID",
        "Execution ID",
        "Status",
        "Created At",
        "API Response",
        "Duration",
        "Summary",
        "Transcript",
        "Recording URL",
        "Success Evaluation",
        "Follow up",
        "Status",
        "Ended At"
      ]);
    }

    var createdAt = "";

    if (result.createdAt) {
      createdAt = Utilities.formatDate(
        new Date(result.createdAt),
        Session.getScriptTimeZone(),
        "dd-MM-yyyy HH:mm:ss"
      );
    }

    // 🛑 FIX RAW JSON SPILL: Write clean string in Column F instead of huge raw text!
    sheet.insertRows(2, 1);

    sheet.getRange(2, 1, 1, 6).setValues([[
      toNumber,
      result.id || "",
      result.executionId || "",
      result.status || "initiated",
      createdAt,
      "OK (Triggered)" // Clean string in Col F to stop text spill!
    ]]);

    return {
      success: code >= 200 && code < 300,
      httpCode: code,
      status: result.status || "",
      callId: result.id || "",
      executionId: result.executionId || "",
      response: text
    };

  } catch (err) {

    return {
      success: false,
      httpCode: 0,
      status: err.message,
      response: err.toString()
    };

  }
}

// Methods we have changedfunction updateSnapServeCalls() {
  function extractDateTimePattern(summaryText) {
  if (!summaryText) return "";
  var pattern = /(\d{4}[-/]\d{2}[-/]\d{2}|\d{2}[-/]\d{2}[-/]\d{4})(?:[,\s]+(?:at|between))?[,\s]+(\d{2}[:.]\d{2}(?:\s*[AP]M)?)/i;
  var match = pattern.exec(summaryText);
  if (match) {
    var rawDate = match[1];
    var rawTime = match[2];
    return formatDateDDMMYYYY(rawDate) + " " + formatTime12Hour(rawTime);
  }
  return "";
}

function formatTime12Hour(timeStr) {
  timeStr = timeStr.trim();
  var ampmMatch = timeStr.match(/(\d{1,2})[.:](\d{2})\s*([AP]M)/i);
  if (ampmMatch) {
    var hours = parseInt(ampmMatch[1], 10);
    var minutes = ampmMatch[2];
    var ampm = ampmMatch[3].toUpperCase();
    var hoursStr = hours < 10 ? "0" + hours : String(hours);
    return hoursStr + ":" + minutes + " " + ampm;
  }
  var hhmmMatch = timeStr.match(/^(\d{1,2})[.:](\d{2})/);
  if (hhmmMatch) {
    var hours = parseInt(hhmmMatch[1], 10);
    var minutes = hhmmMatch[2];
    var ampm = "AM";
    if (hours >= 12) {
      ampm = "PM";
      if (hours > 12) hours -= 12;
    } else if (hours === 0) {
      hours = 12;
    }
    var hoursStr = hours < 10 ? "0" + hours : String(hours);
    return hoursStr + ":" + minutes + " " + ampm;
  }
  return timeStr;
}

function formatDateDDMMYYYY(dateStr) {
  dateStr = dateStr.trim();
  var yyyymmdd = dateStr.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (yyyymmdd) return yyyymmdd[3] + "/" + yyyymmdd[2] + "/" + yyyymmdd[1];
  var ddmmyyyy = dateStr.match(/^(\d{2})[-/](\d{2})[-/](\d{4})/);
  if (ddmmyyyy) return ddmmyyyy[1] + "/" + ddmmyyyy[2] + "/" + ddmmyyyy[3];
  return dateStr;
}

function extractCallbackTimeFromSummary(summaryText) {
  var absolute = extractDateTimePattern(summaryText);
  if (absolute) return absolute;
  if (!summaryText) return "";
  var regex = /(?:callback|call back|called back|call again)\s+([^.]+)/gi;
  var match = regex.exec(summaryText);
  if (!match) return "";
  var candidate = match[1].trim().replace(/^(?:for|at|on|to)\s+/i, "").replace(/,\s*instead$/i, "").replace(/,\s*which\s+.*$/i, "");
  var cleanParts = candidate.split(/\s+(?:as|because|since|to\s+discuss|for\s+discuss)\s+/i);
  return cleanParts[0].trim();
}

function extractDemoTimeFromSummary(summaryText) {
  var absolute = extractDateTimePattern(summaryText);
  if (absolute) return absolute;
  if (!summaryText) return "";
  var regex = /(?:demo to be booked for|demo for|meeting at|meeting on|demo at|demo on|demo)\s+([^.]+)/gi;
  var match = regex.exec(summaryText);
  if (!match) return "";
  var candidate = match[1].trim().replace(/^(?:for|at|on|to)\s+/i, "").replace(/,\s*instead$/i, "").replace(/,\s*which\s+.*$/i, "");
  var cleanParts = candidate.split(/\s+(?:as|because|since|to\s+discuss|for\s+discuss)\s+/i);
  return cleanParts[0].trim();
}

// ---- NEW FUNCTION: CLEANS THE DISPOSITION STATUS STRING ----
function extractStatusAndFollowUp(rawOutcome, summaryText) {
  var result = { status: "", followUp: "" };
  if (!rawOutcome) return result;

  if (rawOutcome.indexOf("Demo Booked") > -1 || rawOutcome.indexOf("Call for Demo") > -1) {
    result.status = "Call for Demo";
    var parts = rawOutcome.split("With ");
    if (parts.length > 1) result.followUp = parts[1];
    else result.followUp = extractDemoTimeFromSummary(summaryText) || rawOutcome;
    
    if (summaryText.toLowerCase().indexOf("callback") > -1) {
      result.status = "Call Back Scheduled";
      result.followUp = extractCallbackTimeFromSummary(summaryText) || "Requested Callback";
    }
  } else if (rawOutcome.indexOf("Call Back Scheduled") > -1) {
    result.status = "Call Back Scheduled";
    var parts = rawOutcome.split("at ");
    if (parts.length > 1) result.followUp = parts[1];
    else result.followUp = extractCallbackTimeFromSummary(summaryText) || "Requested Callback";
  } else {
    // This chops off the long description after the colon (:)
    var cleaned = rawOutcome.split(":")[0].split("-")[0].trim();
    var lower = cleaned.toLowerCase();
    
    // We map it to the EXACT strings the customer requested
    if (lower.indexOf("not answered") > -1) {
      result.status = "Pick-up But Not Answered";
    } else if (lower.indexOf("requested details") > -1) {
      result.status = "Requested Details";
    } else if (lower.indexOf("not interested") > -1) {
      result.status = "Not Interested";
    } else if (lower.indexOf("not connected") > -1) {
      result.status = "Not Connected";
    } else {
      result.status = cleaned;
    }
  }
  return result;
}
///////////////////////////////////////////////////////////////////////////////////////////

function extractFollowUpDate(call) {
  if (!call) return "";
  
  var statusText = (getCleanDispositionText(call) || "").toLowerCase();

  // 🛑 Block "not interested" immediately!
  if (statusText.indexOf("not interested") > -1) {
    return "";
  }
  
  // 🎯 ONLY allow Follow-Up dates for Callback, Follow Up, Demo, Scheduled, Interested!
  var isFollowUpCall = (
    statusText.indexOf("call back") > -1 ||
    statusText.indexOf("callback") > -1 ||
    statusText.indexOf("follow up") > -1 ||
    statusText.indexOf("followup") > -1 ||
    (statusText.indexOf("interested") > -1 && statusText.indexOf("not interested") === -1) ||
    statusText.indexOf("demo") > -1 ||
    statusText.indexOf("meeting") > -1 ||
    statusText.indexOf("schedule") > -1
  );

  // If Not Interested / Requested Details / Not Answered -> ALWAYS return BLANK!
  if (!isFollowUpCall) {
    return "";
  }

  // 1. Check call.metadata for scheduled callback / meeting time
  if (call.metadata) {
    try {
      var meta = typeof call.metadata === "string" ? JSON.parse(call.metadata) : call.metadata;
      if (meta) {
        var dt = meta.callbackAt || meta.scheduledCallbackAt || meta.meetingTime || meta.requestedTime || meta.callback_at;
        if (dt) return formatIstDate(dt);
      }
    } catch(e) {}
  }
  
  // 2. Check call.dispositionResult
  if (call.dispositionResult) {
    var disp = call.dispositionResult;
    if (typeof disp === "string") {
      try { disp = JSON.parse(disp); } catch(e) {}
    }
    if (disp && typeof disp === "object") {
      var d = disp.callbackAt || disp.followUp || disp.follow_up || disp.callback_time || disp.date || disp["Follow Up Date"] || disp["Follow Up"];
      if (d) return formatIstDate(d);
    }
  }

  // 3. Extract Scheduled Demo / Callback Date from AI Summary
  var summary = call.callSummary || "";
  if (summary) {
    var dates = summary.match(/\b((?:next\s+)?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?,?\s*\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}(?:\s*,?\s*at\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?)\b/gi);
    if (dates && dates.length > 0) {
      return formatIstDate(dates[dates.length - 1]);
    }
  }
  
  return "";
}

function formatIstDate(raw) {
  if (!raw) return "";
  try {
    var str = String(raw).trim().replace(/,\s*at\s+/i, " ").replace(/\bat\s+/i, "");
    if (str === "null" || str === "undefined") return "";

    var months = { "january": "01", "jan": "01", "february": "02", "feb": "02", "march": "03", "mar": "03", "april": "04", "apr": "04", "may": "05", "june": "06", "jun": "06", "july": "07", "jul": "07", "august": "08", "aug": "08", "september": "09", "sep": "09", "october": "10", "oct": "10", "november": "11", "nov": "11", "december": "12", "dec": "12" };
    
    // Parse "Monday, 10 August 2026 11:00 AM" -> "10-08-2026 11:00 AM"
    var m = str.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?,?\s*(\d{1,2})\s+([a-z]+)\s+(\d{4})(?:\s+(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?))?/i);
    if (m) {
      var day = ("0" + m[1]).slice(-2);
      var month = months[m[2].toLowerCase()] || "08";
      var year = m[3];
      var time = m[4] || "";
      return day + "-" + month + "-" + year + (time ? " " + time : "");
    }

    var d = new Date(str);
    if (!isNaN(d.getTime())) {
      if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) return "";
      return Utilities.formatDate(d, "Asia/Kolkata", "dd-MM-yyyy hh:mm a");
    }
    
    return str;
  } catch(e) {
    return String(raw);
  }
}

function getCleanDispositionText(call) {
  if (!call) return "";
  var disp = call.dispositionResult || call.disposition;
  if (!disp) return "";
  
  if (typeof disp === "string") {
    try {
      var parsed = JSON.parse(disp);
      if (parsed && typeof parsed === "object") disp = parsed;
    } catch(e) {}
  }
  
  var text = "";
  if (typeof disp === "string") {
    text = disp;
  } else if (typeof disp === "object") {
    text = disp["disposition"] || disp["outcome"] || disp["status"] || disp["Call Outcome"] || disp["Status"] || disp["primary"] || disp["sub"] || JSON.stringify(disp);
  } else {
    text = String(disp);
  }

  if (text.indexOf(":") > -1) {
    text = text.split(":")[0].trim();
  }
  
  return text;
}

function getCallerCustomerNumber(call) {
  if (!call) return "";
  var dir = String(call.direction || call.type || "").toLowerCase();
  
  // Inbound call (Customer calling AI) -> Customer is fromNumber
  if (dir === "inbound") {
    return call.fromNumber || call.from || call.toNumber || "";
  }
  
  // Outbound call (AI calling Customer) -> Customer is toNumber
  return call.toNumber || call.to || call.fromNumber || "";
}

function updateSnapServeCalls() {
  var API_KEY = "sk_live_f293f23aa522368b25cfe46d19935109e1bacbbba373ea664c18a5df0d0742e8";
  var AGENT_ID = 261;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Calls");
  if (!sheet) return;

  var response;
  try {
    response = UrlFetchApp.fetch(
      "https://app.snapserve.ai/api/calls?agentId=" + AGENT_ID + "&limit=100",
      { method: "get", headers: { Authorization: "Bearer " + API_KEY }, muteHttpExceptions: true }
    );
  } catch (e) {
    Logger.log("Network error fetching calls: " + e.toString());
    return;
  }

  if (response.getResponseCode() != 200) {
    Logger.log("Failed to fetch calls: " + response.getContentText());
    return;
  }

  var calls;
  try {
    calls = JSON.parse(response.getContentText());
  } catch (parseError) {
    Logger.log("JSON Parse Error: " + parseError.toString());
    return; 
  }
  
  var values = sheet.getDataRange().getValues();

  for (var c = 0; c < calls.length; c++) {
    var call = calls[c];
    var callId = Number(call.id);
    var execId = String(call.executionId || "").trim();
    var finalStatus = call.status || "";
    var createdAt = call.createdAt ? Utilities.formatDate(new Date(call.createdAt), Session.getScriptTimeZone(), "dd-MM-yyyy HH:mm:ss") : "";
    var endedAt = call.endedAt ? Utilities.formatDate(new Date(call.endedAt), Session.getScriptTimeZone(), "dd-MM-yyyy HH:mm:ss") : "";

    var customerMobile = getCallerCustomerNumber(call);
    var fullDispText = getCleanDispositionText(call);
    var followUpValue = extractFollowUpDate(call);
    var statusValue = fullDispText || finalStatus;
    
    var successValue = "";
    if (call.successEvaluation !== null && call.successEvaluation !== undefined) {
      successValue = String(call.successEvaluation);
    }

    var found = false;
    // Search by Call ID (Col B) OR Execution ID (Col C)
    for (var i = 1; i < values.length; i++) {
      var rawCellVal = String(values[i][1] || "").replace(/[^0-9]/g, "");
      var sheetCallId = Number(rawCellVal); 
      var sheetExecId = String(values[i][2] || "").trim();

      if ((sheetCallId > 0 && sheetCallId === callId) || (execId && sheetExecId && execId === sheetExecId)) {
        if (customerMobile) sheet.getRange(i + 1, 1).setValue(customerMobile); // Fix Col A (Customer Mobile)
        sheet.getRange(i + 1, 4).setValue(finalStatus); 
        
        if (call.durationSeconds) sheet.getRange(i + 1, 7).setValue(call.durationSeconds); // Col G
        if (call.callSummary) sheet.getRange(i + 1, 8).setValue(call.callSummary);        // Col H
        if (call.transcript) sheet.getRange(i + 1, 9).setValue(call.transcript);          // Col I
        if (call.recordingUrl) sheet.getRange(i + 1, 10).setValue(call.recordingUrl);      // Col J
        
        sheet.getRange(i + 1, 11).setValue(successValue);                                 // Col K (Success)
        sheet.getRange(i + 1, 12).setValue(followUpValue || "");                          // Col L (Follow up)
        sheet.getRange(i + 1, 13).setValue(statusValue);                                   // Col M (Status)
        if (endedAt) sheet.getRange(i + 1, 14).setValue(endedAt);                          // Col N (Ended At)
        
        found = true;
        break;
      }
    }

    // 🎯 IF NEW CALL NOT IN SHEET -> ONLY INSERT IF IT IS FROM TODAY!
    if (!found) {
      var callDate = new Date(call.createdAt);
      var today = new Date();
      
      // If call was created TODAY, insert it automatically!
      if (callDate.toDateString() === today.toDateString()) {
        sheet.insertRows(2, 1);
        sheet.getRange(2, 1, 1, 14).setValues([[
          customerMobile,
          callId,
          call.executionId || "",
          finalStatus,
          createdAt,
          "OK",
          call.durationSeconds || "",
          call.callSummary || "",
          call.transcript || "",
          call.recordingUrl || "",
          successValue,
          followUpValue || "",
          statusValue,
          endedAt
        ]]);
        values = sheet.getDataRange().getValues();
      }
    }
  }

  // 🎯 AUTOMATIC SORT: Sort Sheet by Column B (Call ID) DESCENDING (Newest Calls at Top!)
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).sort({ column: 2, ascending: false });
  }
}

function processFollowUpReminders() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("UniqueContacts");
  if (!sheet) return;

  var now = new Date();
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;

  var headers = data[0];
  var mobileCol = headers.indexOf("WhatsApp ID");
  var amobileCol = headers.indexOf("Another Number");
  var nameCol = headers.indexOf("WhatsApp Name");
  var employeeCol = headers.indexOf("Employee") !== -1 ? headers.indexOf("Employee") : headers.indexOf("Branch");
  var statusCol = headers.indexOf("Status");
  var productCol = headers.indexOf("Product Name") !== -1 ? headers.indexOf("Product Name") : headers.indexOf("Client Budget");
  var followUpCol = headers.indexOf("Follow-up");
  var formLinkCol = headers.indexOf("Form Link");
  var customerTickCol = headers.indexOf("Customer Reminder Sent");
  var employeeTickCol = headers.indexOf("Employee Reminder Sent");
  var employeeOTickCal = headers.indexOf("Overdue Reminder Sent");

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var followUp = row[followUpCol];
    if (!(followUp instanceof Date)) continue;

    var followUpDate = new Date(followUp);
    var diffMs = followUpDate - now;
    var diffMin = diffMs / (1000 * 60);

    var name = row[nameCol];
    var mobile = row[mobileCol];
    var amobile = row[amobileCol];
    var employee = row[employeeCol];
    var status = row[statusCol];
    var product = row[productCol];
    var formLink = row[formLinkCol];
    var customerTick = row[customerTickCol];
    var employeeTick = row[employeeTickCol];
    var employeeOTick = row[employeeOTickCal];
    var formattedFollowUp = formatDateForReminder(followUpDate);

    // Customer Reminder: 45 min before
    if (!customerTick && Math.abs(diffMin - 45) <= 3 && followUpDate > now) {
      if (!["New", "Not Interested", "Converted", "Follow-Up (Hot Lead)","STOP"].includes(status)) {
        sendToBothNumbers(mobile, amobile, function (num) {
          triggerWhatsAppReminderToCustomer1(num, name, status, product, formattedFollowUp, "Follow-up Reminder");
          var mobileWithout91 = num.toString().replace(/^91/, '');
          triggerVoiceCallToCustomer(mobileWithout91);
          triggerSMSToCustomer(mobileWithout91, name, formattedFollowUp);
        });
        sheet.getRange(i + 1, customerTickCol + 1).setValue("🔴");
      }
    }

    // Customer Reminder: 15 min before
    if (customerTick === "🔴" && Math.abs(diffMin - 15) <= 3 && followUpDate > now) {
      if (!["New", "Not Interested", "Converted", "Follow-Up (Hot Lead)","STOP"].includes(status)) {
        sendToBothNumbers(mobile, amobile, function (num) {
          triggerWhatsAppReminderToCustomer2(num, name, status, product, formattedFollowUp, "Follow-up Reminder");
          var mobileWithout91 = num.toString().replace(/^91/, '');
          triggerVoiceCallToCustomer(mobileWithout91);
          triggerSMSToCustomer(mobileWithout91, name, formattedFollowUp);
        });
        sheet.getRange(i + 1, customerTickCol + 1).setValue("🔴🔴");
      }
    }

    // Employee Reminder: 15 min before
    if (!employeeTick && Math.abs(diffMin - 15) <= 3 && followUpDate > now) {
      if (!["New","Not Interested", "Converted"].includes(status)) {
        var employeeNumber = getEmployeePhoneNumber(employee);
        if (employeeNumber) {
          triggerWhatsAppReminderToEmployee(employeeNumber, name, mobile, employee, status, product, formattedFollowUp, formLink, "Follow-up Reminder");
          sheet.getRange(i + 1, employeeTickCol + 1).setValue("🔴");
        }
      }
    }

    // OVERDUE REMINDERS
    if (followUpDate < now && !["New","Not Interested", "Converted"].includes(status)) {
      var employeeNumber = getEmployeePhoneNumber(employee);
      if (!employeeOTick && employeeNumber) {
        triggerWhatsAppReminderToEmployee(employeeNumber, name, mobile, employee, status, product, formattedFollowUp, formLink, "Overdue Reminder");
        sheet.getRange(i + 1, employeeOTickCal + 1).setValue("🔴");
      }
    }
  }
}
