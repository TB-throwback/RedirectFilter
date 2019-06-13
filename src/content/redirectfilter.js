Components.utils.import("resource://gre/modules/FileUtils.jsm"); //to get profile directory
//Components.utils.import("resource://gre/modules/NetUtil.jsm"); // Набор функуий для удобной работы с потоками

(function(){
const Cc = Components.classes;
const Ci = Components.interfaces;

let strings;

//############### redirectRunner ##################
let redirectRunner = function  () { // redirect action class	

	// options	
	let options = new Array();
	//// Load or set default options
	let prefs = Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService);
	prefs = prefs.getBranch("extensions.redirectfilter.");
	try {
		options['keepOriginalDate'] = prefs.getBoolPref("keepOriginalDate.enabled");
	} catch (e) {
		pref("extensions.redirectfilter.keepOriginalDate.enabled", false);
		options['keepOriginalDate'] = false;
	}
	try {
		options['redirectCCHeader'] = prefs.getBoolPref("redirectCCHeader.enabled");
	} catch (e) {
		pref("extensions.redirectfilter.redirectCCHeader.enabled", false);
		options['redirectCCHeader'] = false;
	}
	try {
		options['redirectToHeader'] = prefs.getBoolPref("redirectToHeader.enabled");
	} catch (e) {
		pref("extensions.redirectfilter.redirectToHeader.enabled", false);
		options['redirectToHeader'] = false;
	}
	try {
		options['redirectSequencesHeaders'] = prefs.getBoolPref("redirectSequencesHeaders.enabled");
	} catch (e) {
		pref("extensions.redirectfilter.redirectSequencesHeaders.enabled", false);
		options['redirectSequencesHeaders'] = false;
	}
	try {
		options['copyToSent'] = prefs.getBoolPref("copyToSent.enabled");
	} catch (e) {
		pref("extensions.redirectfilter.copyToSent.enabled", true);
		options['copyToSent'] = true;
	}
	try {
		options['markAsForwarded'] = prefs.getBoolPref("markAsForwarded.enabled");
	} catch (e) {
		pref("extensions.redirectfilter.markAsForwarded.enabled", true);
		options['markAsForwarded'] = true;
	}
	try {
		options['account'] = prefs.getCharPref("account");
	} catch (e) {
		pref("extensions.redirectfilter.account", "useFolderOwnerAccount");
		options['account'] = "useFolderOwnerAccount";
	}
	try {
		options['changeReplyToHeader'] = prefs.getBoolPref("changeReplyToHeader.enabled");
	} catch (e) {
		pref("extensions.redirectfilter.changeReplyToHeader.enabled", false);
		options['changeReplyToHeader'] = false;
	}
	try {
		options['newReplyToHeader'] = prefs.getComplexValue("newReplyToHeader",Ci.nsISupportsString).data; // read utf8 string preference
	} catch (e) {
		pref("extensions.redirectfilter.newReplyToHeader", "");
		options['newReplyToHeader'] = "";
	}
		
	// Activiti manager interfaces
	const nsIAP = Ci.nsIActivityProcess;
	const nsIAE = Ci.nsIActivityEvent;
	const nsIAM = Ci.nsIActivityManager;
	
	let gActivityManager;
	let process; // show redirection progress
	let event; // show message
	let messageCount;
	let errorCount;
	let currentMessageNum;
	
	// Queue param
	//let currentlyInQueue;
	//let maxQueueLength;
	//let threadForWait;
	//let canSendNext;
	let msgQueue;
	
	// debug
	let consoleService;
	
	// system new line
	//let sysNewLine = ""; // The new line in Linux (Tested in Ubuntu) is \n. In windows it is \r\n. We need to use correct new line.
	
	// e-mail regexp for search in string
	// it may be not the best regexp for email, but somehow more complexive regexp freeze process:(
	// if you are going to change this regexp, change reg_email_only too UPD we dont need it any more (no email check in addon, serever will return error if something wrong) 
	// let reg_email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+/i;

	// это локализация UPD инициализировано в redirectListener
	//let strings = window.document.getElementById("redirectfilter-strings");

	this.go = function (aMsgHdrs, aActionValue, aListener, aType, aMsgWindow) { // функция применения фильтра
		// for debug
		consoleService = Cc["@mozilla.org/consoleservice;1"].getService(Ci.nsIConsoleService);
		
		// load redirect params		
		try {
			let jsonPrefs = JSON.parse(aActionValue);
			for (attr in jsonPrefs) {
				if(/^(false|null|undefined|NaN)?$/i.test(jsonPrefs[attr]))
					options[attr] = false;
				else if (jsonPrefs[attr] == 'true')
					options[attr] = true;
				else
					options[attr] = jsonPrefs[attr];
			}
			// check address to redirect to
			if ((typeof(options['redirectTo']) == 'undefined') || (options['redirectTo'] == '')) {
				debug(strings['errorRedirectToEmail']);
				return;
			}
		} catch (e) {
			if ((typeof(aActionValue) != 'undefined') && (aActionValue != '')) {
				options['redirectTo'] = aActionValue; // compatibility with previous version
			} else {
				debug(strings['errorRedirectToEmail']+":\n"+e);
				return;
			}				
		}
		
		let messenger = Components.classes["@mozilla.org/messenger;1"].createInstance(Components.interfaces.nsIMessenger);
		
		let am = Components.classes["@mozilla.org/messenger/account-manager;1"].getService(Components.interfaces.nsIMsgAccountManager);
		
		let accountKey; // key of account (server) , from which send message
		let msgIdentity; // identity (user) from which message is sending
		
		// statusbar var initiation
		gActivityManager = Cc["@mozilla.org/activity-manager;1"].getService(nsIAM);
		process = Cc["@mozilla.org/activity-process;1"].createInstance(nsIAP);
		event = Cc["@mozilla.org/activity-event;1"].createInstance(nsIAE);
		messageCount = aMsgHdrs.length;
		currentMessageNum = 0;
		errorCount = 0;
		process.init(strings["redirecting"], null);
		process.contextType = "account";     // group this activity by account
		process.contextObj = aMsgHdrs.queryElementAt(0, Ci.nsIMsgDBHdr).folder.rootFolder.server;   // account in question
		gActivityManager.addActivity(process);
		// lets go show that we are sending
		process.setProgress(strings["redirected"] + " 0" +"\\"+messageCount, 0, 0);
		
		// queueing
		//maxQueueLength = 1;
		//currentlyInQueue = 0;
		//canSendNext = true;
		//threadForWait = Cc["@mozilla.org/thread-manager;1"] // we need it to wait for asynch job complete (see https://developer.mozilla.org/en/Code_snippets/Threads )
                //        .getService(Ci.nsIThreadManager)
                //        .currentThread;
        	msgQueue = new Array();
		
		let msgSend; // message sender component instance
		
		if (options['account']=="useFolderOwnerAccount") {
			msgIdentity = am.createIdentity();
			let firstMsgHdr = aMsgHdrs.queryElementAt(0, Ci.nsIMsgDBHdr); // take the first message headers
			for (let i = 0; i < am.accounts.length; i++) { // go through all accounts and look for one that have root folder similar to first redirecting message root folder
				let amacc = am.accounts.queryElementAt(i, Ci.nsIMsgAccount);
				if (amacc.incomingServer.rootFolder == firstMsgHdr.folder.rootFolder) {
					msgIdentity.copy(amacc.defaultIdentity);
					accountKey = amacc.key;
					break;
				}
			}
			if (!accountKey) {
				debug(strings["errorWhileGettingMsgFolderOwnerAccount"]);
				return;
			}
			msgIdentity.doFcc = options['copyToSent'];
		} else if (options['account']=="useDefaultAccount") { // take default accountkey and create copy of default identity
			msgIdentity = am.createIdentity();
			msgIdentity.copy(am.defaultAccount.defaultIdentity);
			accountKey = am.defaultAccount.key;
			msgIdentity.doFcc = options['copyToSent'];
		} else if (options['account'].substring(0,7)=="account") { // use selected account
			msgIdentity = am.createIdentity();
			try {
				msgIdentity.copy(am.getAccount(options['account']).defaultIdentity);
				accountKey = options['account'];
				msgIdentity.doFcc = options['copyToSent'];
			} catch (e) {
				debug(strings["errorAccountNotExists"]+":\n"+e);
				stopSending();
				return;
			}
		}

		for (let i = 0; i < aMsgHdrs.length; i++) { // sendin loop
			let redRunner = this;
			//let i=it;
			//let aMsgHdrsF=aMsgHdrs;
			//let forLoop = function (i, aMsgHdrs) {
			// хедеры исходного сообщения
			let msgHdr = aMsgHdrs.queryElementAt(i, Ci.nsIMsgDBHdr);
			//consoleService.logStringMessage("point1 msgHdr.author="+msgHdr.author);
			// Все эти объекты нужн, чтобы исходное сообщение направить в поток
			let MessageURI = msgHdr.folder.getUriForMsg(msgHdr);
			let MsgService = messenger.messageServiceFromURI(MessageURI);
			let messageStream = Components.classes["@mozilla.org/network/sync-stream-listener;1"].createInstance().QueryInterface(Components.interfaces.nsIInputStream);

			let wholeString = '';
			let dataListener = {
				QueryInterface: function(aIID) {
					if (aIID.equals(Components.interfaces.nsISupports) || aIID.equals(Components.interfaces.nsIStreamListener))
						return this;
					throw Components.results.NS_NOINTERFACE;
				},
				onStartRequest: function() {
					//consoleService.logStringMessage("COMPLETE onStartRequest");
				},
				onDataAvailable: function(req, context, inputStream, offset, count) {
						let ScriptInputStream = Components.classes["@mozilla.org/scriptableinputstream;1"].createInstance().QueryInterface(Components.interfaces.nsIScriptableInputStream);
						ScriptInputStream.init(inputStream);
						try {
							ScriptInputStream.available();
							while (ScriptInputStream.available()) {
									wholeString += ScriptInputStream.read(count);
									//consoleService.logStringMessage("str LOOP");
							}
						} catch (e) {
							//consoleService.logStringMessage("COMPLETE str reade, length="+wholeString.length);
						}
						//consoleService.logStringMessage("point2 msgHdr.author="+msgHdr.author);
						//consoleService.logStringMessage("str readed, length="+wholeString.length+", available=");
						//onMessageRead(inputStream, count);
				},
				onStopRequest: function(x, msgHdrX) {
					return function () {
						try {
							//consoleService.logStringMessage("point3 msgHdrX.author="+msgHdrX.author);
							//consoleService.logStringMessage("COMPLETE onStopRequest, length="+wholeString.length);
							//consoleService.logStringMessage("x="+x);
							//consoleService.logStringMessage("msgHdrX.author="+msgHdrX.author);
							//consoleService.logStringMessage("cntr="+cnt);
							//return;

							if (options['account']=="useMsgHdrAccount") { // take account and its default identity from message header
								msgIdentity = am.createIdentity();
								accountKey = msgHdrX.accountKey;
								msgIdentity.copy(am.getAccount(accountKey).defaultIdentity);
								msgIdentity.doFcc = options['copyToSent'];
							}
					
							//consoleService.logStringMessage("point4 msgHdrX.author="+msgHdrX.author);
							// Извлекаем чистый email из заголовка UPD не извлекаем, так как и без этого работает нормально.
							/*let from_email;
							try { from_email = reg_email.exec(msgHdrX.author)[0];}
							catch(e) {
								errorCount++;
								debug(strings["errorParsingAuthorEmail"]+"\nmsgHdrX.author="+msgHdrX.author+"\n"+e)
								stopSending();
								return;
							}*/
							//alert(from_email+" nnn "+msgHdrX[i].author);
					
							//параметры пересылки
							let cf = Components.classes["@mozilla.org/messengercompose/composefields;1"].createInstance(Components.interfaces.nsIMsgCompFields); // new message headers and parameters to

							cf.from = msgHdrX.author;
							cf.to = mimeEncode(options["redirectTo"]);
							
					
					
							// временный файл для сообщения, создаются уникальные файлы во временной папке на основе шаблона имени
							let file = Components.classes["@mozilla.org/file/directory_service;1"]. // file to save new message TODO send files from memory
									getService(Components.interfaces.nsIProperties).
										get("TmpD", Components.interfaces.nsIFile);
							file.append("redirect.msg");
							file.createUnique(Components.interfaces.nsIFile.NORMAL_FILE_TYPE, 0666);
						

							// Поток для записи в файл
							let foStream = Components.classes["@mozilla.org/network/file-output-stream;1"].
										   createInstance(Components.interfaces.nsIFileOutputStream);
					
							try {
								// write, create, truncate
								foStream.init(file, 0x02 | 0x08 | 0x20, 0666, 0);
						
								let str = "";
								let strRest = "";
								let tempArr;
								let bodyBeginingIndex;
								// Считываем по порциям
								bodyBeginingIndex = wholeString.search(/(\r?\n){2,}/mg);

								// BODY begining in strRest, extract and proceed the last headers
								//let newHdrs = new Object(); //Array of created message headers
								let newHdrs = proceedHeaders(wholeString.substring(0,bodyBeginingIndex));

								// lets complete MUST HAVE headers: Date, From, To, Resent-from
								if (newHdrs['Date']==undefined) {
									let nowDate = new Date();
									newHdrs['Date'] = "Date: "+nowDate.toString().replace(/^(\w{3})\s(\w{3})\s(\d{2})\s(.*)GMT(.*)$/,"$1, $3 $2 $4$5"); // format date string the way it should be
								}
								if (newHdrs['From']==undefined) {
									newHdrs['From'] = "From: "+msgHdrX.author;
								}
								if (newHdrs['To']==undefined) {
									newHdrs['To'] = "To: "+mimeEncode(options["redirectTo"]);
								}
								if (newHdrs['Resent-from']==undefined) {
									newHdrs['Resent-from'] = "Resent-from: "+msgIdentity.email;
								}
							
								// change Reply-To header if option is set
								if (options['changeReplyToHeader']) {							
									newHdrs['Reply-To'] = "Reply-To: "+mimeEncode(options['newReplyToHeader']);
								}
							
								// take subject from header because subject in message source may be no actual.
								// Other filter can change Subject (for example, filtaquilla) but it doesnot concerning message source
								//consoleService.logStringMessage("subject from src newHdrs[Subject]="+newHdrs['Subject']);
								newHdrs['Subject'] = mergeSubject(newHdrs['Subject'],msgHdrX.subject);
								//consoleService.logStringMessage("subject merged newHdrs[Subject]="+newHdrs['Subject']);
								//consoleService.logStringMessage("subject from header var msgHdrX.subject="+msgHdrX.subject);
								cf.subject = /^Subject:\s(.*)/i.exec(newHdrs['Subject'])[1];
								//consoleService.logStringMessage("subject var cf.subject="+cf.subject);
								//if (msgHdrX.subject!=undefined) {
								//	newHdrs['Subject'] = "Subject: "+msgHdrX.subject;
								//}
							

								// lets write headers
								let newHdrsStr = "";
								for (let key in newHdrs) {
									newHdrsStr = newHdrs[key] +"\r\n" + newHdrsStr;
								}
								newHdrsStr = handleNewLines(newHdrsStr);
								foStream.write(newHdrsStr, newHdrsStr.length);

								// lets handle body
								let msgBody = handleNewLines(wholeString.substring(bodyBeginingIndex,wholeString.length));
								foStream.write(msgBody, msgBody.length);
								
								// close stream
								if (foStream instanceof Components.interfaces.nsISafeOutputStream) {
									foStream.finish();
								} else {
									foStream.close();
								}
							} catch (e) {
								errorCount++;
								debug(strings["errorCreationMessage"]+":\n"+e);
								if (x >= aMsgHdrs.length-1) {stopSending();} // if it is the last message in a row
								return;
							}
							//return;
					
							// отправляем
						
							try {
								//consoleService.logStringMessage("currentlyInQueue=");
								/*while (!canSendNext) //while queue fo messages is full TODO now, i dont know why, canSendNext is GLOBAL and it meens that we have one queue for all redirection processes
									threadForWait.processNextEvent(true); // wait
								canSendNext=false;*/
								//consoleService.logStringMessage("msgIdentity.email="+msgIdentity.email);
								//consoleService.logStringMessage("accountKey="+accountKey);
								//consoleService.logStringMessage("cf.subject="+cf.subject);
								//consoleService.logStringMessage("msgHdrX.subject="+msgHdrX.subject);
							
								//consoleService.logStringMessage("file="+file);
								//msgSend.NotifyListenerOnStopSending(0,null,"",null); 	
								// start sending message in background TODO create message queue. Now it send all simultaniosly
								if (x == 0) { //send the first message
									msgSend = Cc["@mozilla.org/messengercompose/send;1"].createInstance(Ci.nsIMsgSend);
									msgSend.sendMessageFile(msgIdentity, accountKey, cf, file, true, false, msgSend.nsMsgDeliverNow, null, redRunner.sendListener, null, "");
								} else { // queue message
									msgQueue.push({'identity' : msgIdentity, 'accKey' : accountKey, 'cf' : cf, 'file' : file});
								}
								//msgSend.sendMessageFile(msgIdentity, accountKey, cf, file, true, false, msgSend.nsMsgDeliverNow, null, redRunner.sendListener, null, "");
							} catch(e) {
								errorCount++;
								debug(strings["errorSendingMessage"]+":\n"+e);
								//canSendNext=true;
								//consoleService.logStringMessage("x="+x);
								//consoleService.logStringMessage("aMsgHdrs.length="+aMsgHdrs.length);
								if (x >= aMsgHdrs.length-1) {stopSending();} // if it is the last message in a row
								return;
							}
							// помечаем сообщение как пересланое TODO на самом деле сообщение отправляется в фоне, поэтому помечать надо в listener-е, который реагирует на завершение отправки, но там почему-то я не могу получить headerы отправленного письма
							if (options['markAsForwarded']) {
								msgHdrX.folder.addMessageDispositionState(msgHdrX, Ci.nsIMsgFolder.nsMsgDispositionState_Forwarded);
							}
						} finally {
							if (x >= aMsgHdrs.length-1) {
								if (aListener) { // now only manual started filters supports async actions, see https://bugzilla.mozilla.org/show_bug.cgi?id=753682
									//aListener.OnStopCopy(0); // filter is done, see https://developer.mozilla.org/en/XPCOM_Interface_Reference/nsIMsgFilterCustomAction
									//consoleService.logStringMessage("Creating messages complete");
								}
							}
						}
					}
				} (i, msgHdr)
			}	
			try {
				MsgService.streamMessage(MessageURI,dataListener, {}, null, false, null);
			} catch (e) {
				errorCount++;
				debug(strings["errorStreamingSourceMessage"]+":\n"+e)
				if (i >= aMsgHdrs.length-1) {stopSending();} // if it is the last message in a row
				return;
			}
		}
		//consoleService.logStringMessage("Run loop complete");
	}
	
	this.sendListener = { // обработка событий отправки
		onStopSending: function(aMsgID, aStatus, aMsg, returnFileSpec) { // When sending complete TODO parse status, and ++errors count if there was an error while sending. Now aMsgID, aStatus, aMsg, returnFileSpec are null (because of thunderbird bug)
			try {
				currentMessageNum++;
				let nextMessage = msgQueue.shift();		
				if (typeof(nextMessage) != 'undefined') { // lets change  progress status if its not the last message
					if (errorCount>0) {
						process.setProgress(strings["redirected"] + " " + currentMessageNum+"\\"+messageCount+" ("+errorCount+" "+strings["errors"]+".)",0,0);
					} else {
						process.setProgress(strings["redirected"] + " " + currentMessageNum+"\\"+messageCount,0,0);
					}
					//send next message 'identity' => msgIdentity, 'accKey' => accountKey, 'cf' => cf, 'file' => file
					let msgSend = Cc["@mozilla.org/messengercompose/send;1"].createInstance(Ci.nsIMsgSend);
					msgSend.sendMessageFile(nextMessage['identity'], nextMessage['accKey'], nextMessage['cf'], nextMessage['file'], true, false, msgSend.nsMsgDeliverNow, null, this, null, "");
				} else { 	//the last message sent, lets show finel event message
					//Removing the process and adding an Event using Process' attributes
					process.state = Components.interfaces.nsIActivityProcess.STATE_COMPLETED;
					gActivityManager.removeActivity(process.id);
					
					// Выводим сообщение о завершении отправки
					if (errorCount>0) {
						event.init(strings["redirectioncomplete"], // aDisplayText
							null, // initiator
							strings["redirected"] + " " + currentMessageNum+"\\"+messageCount+" ("+errorCount+" "+strings["errors"]+".)", // aDisplayText
							process.startTime,  // start time
							Date.now());        // completion time
					} else {
						event.init(strings["redirectioncomplete"], // aDisplayText
							null, // initiator
							strings["redirected"] + " " + currentMessageNum+"\\"+messageCount, // aDisplayText
							process.startTime,  // start time
							Date.now());        // completion time
					}						

					event.contextType = process.contextType; // optional
					event.contextObj = process.contextObj;   // optional
							
					gActivityManager.addActivity(event); // show event
				}
			} finally {
				//canSendNext=true;
			}
		},
		// just redraw status on every sending events
		onGetDraftFolderURI: function (folderURI)   {setStatus();},
		onProgress: function  (msgID, progress, progressMax)   {setStatus();},
		onSendNotPerformed: function  (msgID, status)   {setStatus();},
		onStartSending: function  (msgID, msgSize)   {setStatus();},
		onStatus: function  (msgID, msg)   {setStatus();}
	};

	let setStatus = function() { // statusbar progress set
		if (errorCount>0) {
			process.setProgress(strings["redirected"] + " " + currentMessageNum+"\\"+messageCount+" ("+errorCount+" "+strings["errors"]+".)",0,0);
		} else {
			process.setProgress(strings["redirected"] + " " + currentMessageNum+"\\"+messageCount,0,0);
		}
	};

	let debug = function (str, ask) { // debug error message somehow. Return true to continue, return false to break
		consoleService.logStringMessage(str);
		if (ask) {
			return confirm(str+"\n\n"+strings["ifProceedSending"]);
		} else {
			alert(str);
		}
	};
	let stopSending = function () {
		//Removing the process and adding an Event using Process' attributes
		process.state = Components.interfaces.nsIActivityProcess.STATE_COMPLETED;
		gActivityManager.removeActivity(process.id);
		
		// Выводим сообщение о завершении отправки
		if (errorCount>0) {
			event.init(strings["redirectioncomplete"], // aDisplayText
				null, // initiator
				strings["redirected"] + " " + currentMessageNum+"\\"+messageCount+" ("+errorCount+" "+strings["errors"]+".)", // aDisplayText
				process.startTime,  // start time
				Date.now());        // completion time
		} else {
			event.init(strings["redirectioncomplete"], // aDisplayText
				null, // initiator
				strings["redirected"] + " " + currentMessageNum+"\\"+messageCount, // aDisplayText
				process.startTime,  // start time
				Date.now());        // completion time
		}

		event.contextType = process.contextType; // optional
		event.contextObj = process.contextObj;   // optional
				
		gActivityManager.addActivity(event); // show event
	};
	let proceedHeaders = function (argstr) {
		// lets try to find headers:
		// Date (if keep original), From, Subject, MIME-Version, Content-Type, Content-Transfer-Encoding, Reply-To
		let arghdrs = new Object();
		//Date
		if (options['keepOriginalDate']) {
			try {
				arghdrs['Date'] = /^Date\:.*(\r?\n\s+.+)*$/mi.exec(argstr)[0];
			} catch (er) {}
		}
		// Copy to
		if (options['redirectCCHeader']) {
			try {
				arghdrs['CC'] = /^CC\:.*(\r?\n\s+.+)*$/mi.exec(argstr)[0];
			} catch (er) {}
		}
		// To
		if (options['redirectToHeader']) {
			try {
				arghdrs['To'] = /^To\:.*(\r?\n\s+.+)*$/mi.exec(argstr)[0];
			} catch (er) {}
		}
		// Dialogs chains
		if (options['redirectSequencesHeaders']) {
			try {
				arghdrs['In-Reply-To'] = /^In-Reply-To\:.*(\r?\n\s+.+)*$/mi.exec(argstr)[0];
			} catch (er) {}
			try {
				arghdrs['References'] = /^References\:.*(\r?\n\s+.+)*$/mi.exec(argstr)[0];
			} catch (er) {}
		}
		// From
		try {
			arghdrs['From'] = /^From\:.*(\r?\n\s+.+)*$/mi.exec(argstr)[0];
		} catch (er) {}

		// Subject
		try {
			arghdrs['Subject'] = /^Subject\:.*(\r?\n\s+.+)*$/mi.exec(argstr)[0];
		} catch (er) {}
		
		// MIME-Version
		try {
			arghdrs['MIME-Version'] = /^MIME-Version\:.*(\r?\n\s+.+)*$/mi.exec(argstr)[0];
		} catch (er) {}

		// Content-Type
		try {
			arghdrs['Content-Type'] = /^Content-Type\:.*(\r?\n\s+.+)*$/mi.exec(argstr)[0];
		} catch (er) {}

		// Content-Transfer-Encoding
		try {
			arghdrs['Content-Transfer-Encoding'] = /^Content-Transfer-Encoding\:.*(\r?\n\s+.+)*$/mi.exec(argstr)[0];
		} catch (er) {}

		// Reply-To
		try {
			arghdrs['Reply-To'] = /^Reply-To\:.*(\r?\n\s+.+)*$/m.exec(argstr)[0];
		} catch (er) {}

		return arghdrs;
	}

	let handleNewLines = function (argustr) { // In Linux version of Thunderbird all mesages have LF line delimiter, but RFC 2822 reqire CRLF line delimiter.
	// argustr MUST NOT end with CR (\r) to not have badly modified end lines when strings will be concatinated
		return argustr.replace(/\r?\n/mg,"\r\n"); // change all single \n (without previous \r) to \r\n
	}
	
	let mimeEncode = function (utf8string) {
		// append a UTF8 string to a mime-encoded subject
		let mimeConvert = Cc["@mozilla.org/messenger/mimeconverter;1"]
				 .getService(Ci.nsIMimeConverter);
		//var decodedSubject =  mimeConvert.decodeMimeHeader(subject, null, false, true);
		let encodedString = utf8string.replace(/"/g,"\\\"");
		//consoleService.logStringMessage("encodedString="+encodedString);
		encodedString = encodedString.replace(/([,]?\s*)([^<>]*[()@,;:\\".\[\]][^<>]*?)(\s*<[^>]+>)/, function (str, coma, sign, address) {
			//consoleService.logStringMessage("coma="+coma);
			//consoleService.logStringMessage("sign="+sign);
			//consoleService.logStringMessage("address="+address);
			return coma + "\""+sign+"\"" + address;
		});
		//consoleService.logStringMessage("encodedString="+encodedString);
		encodedString = mimeConvert.encodeMimePartIIStr_UTF8(encodedString, true, "UTF-8", 0, 72);
		//consoleService.logStringMessage("encodedString="+encodedString);
		//let decodedSubject =  mimeConvert.decodeMimeHeader(encodedString, null, false, true);
		//consoleService.logStringMessage("decodedSubject="+decodedSubject);
		return encodedString;
	}
	
	let mergeSubject = function (subj1, subj2) { // subj1 from message source may not contain changes from other filter actions, subj2 from nsIMsgDBHdr doesnt contain Re: prefix (why?), so, we have to merge it
		if (/^subject:\sre:\s/i.test(subj1) && !/^re:\s/i.test(subj2))
			return /^Subject:\s(Re:\s)+/i.exec(subj1)[0]+subj2;
		else
			return 'Subject: '+subj2;
	}
}

//############### redirectListener ##################

let redirectListener = function  () { // it listen for users called filter action and create instance of redirectRunner
	//const Cc = Components.classes;
	//const Ci = Components.interfaces;
	
	//let reg_email_only = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+$/i; //only email in string
	//let reg_email_with_sign = /^.*<[A-Z0-9._%+-]+@[A-Z0-9.-]+>$/i; //email with previous string

	// Localization
	let stringsObj = document.getElementById("redirectfilter-strings"); // это локализация
	strings = new Array(); // Copy strings to array because mac os could garbage collect document variable and we'll not be able to read strings further
	strings['redirecting']=stringsObj.getString("redirectfilter.redirecting");
	strings['redirected']=stringsObj.getString("redirectfilter.redirected");
	strings['errorWhileGettingMsgFolderOwnerAccount']=stringsObj.getString("redirectfilter.errorWhileGettingMsgFolderOwnerAccount");
	strings['errorParsingAuthorEmail']=stringsObj.getString("redirectfilter.errorParsingAuthorEmail");
	strings['errorCreationMessage']=stringsObj.getString("redirectfilter.errorCreationMessage");
	strings['errorSendingMessage']=stringsObj.getString("redirectfilter.errorSendingMessage");
	strings['errorStreamingSourceMessage']=stringsObj.getString("redirectfilter.errorStreamingSourceMessage");
	strings['errors']=stringsObj.getString("redirectfilter.errors");
	strings['redirectioncomplete']=stringsObj.getString("redirectfilter.redirectioncomplete");
	strings['ifProceedSending']=stringsObj.getString("redirectfilter.ifProceedSending");
	strings['actionname']=stringsObj.getString("redirectfilter.actionname");
	strings['mustbeemail']=stringsObj.getString("redirectfilter.mustbeemail");
	strings['errorRedirectToEmail']=stringsObj.getString("redirectfilter.errorRedirectToEmail");
		
	this.filter = { // это спец структура для создания фильтра
		id: "redirectfilter@irkit.ru#redirectto", // UID, используется, кстати, в css
		name: strings["actionname"], // Имя, берется в локализации

		apply: function(aMsgHdrs, aActionValue, aListener, aType, aMsgWindow) { // функция применения фильтра
			let redirectrunner1 = new redirectRunner(); // create new instance of redirect runner
			redirectrunner1.go(aMsgHdrs, aActionValue, aListener, aType, aMsgWindow); // and start redirection
		},

		isValidForType: function(type, scope) {return true;}, // Проверка типа

		validateActionValue: function(value, folder, type) { // проверка значения в поле параметра на емэйльность
			//if (!value.match(reg_email_only)) {
			//	return strings["mustbeemail"];
			//}
			return null;
		}, 

		allowDuplicates: true,
		needsBody: false,
		//isAsync: true,
	}
	//this.logfilter = {id: "redirectfilter@irkit.ru#log",name: "Log to error console",apply: function(aMsgHdrs, aActionValue, aListener, aType, aMsgWindow) {let consoleService = Components.classes["@mozilla.org/consoleservice;1"].getService(Components.interfaces.nsIConsoleService);consoleService.logStringMessage("!!!!!!!!!!!!NEXT FILTER!!!!!!!!!");}, isValidForType: function(type, scope) {return true;}, validateActionValue: function(value, folder, type){return null;},allowDuplicates: true,needsBody: false,}
	this.start = function() {
		// add filter action to filter action list
		let filterService = Cc["@mozilla.org/messenger/services/filters;1"]
								.getService(Ci.nsIMsgFilterService);
		filterService.addCustomAction(this.filter);
		//filterService.addCustomAction(this.logfilter);
	}
}

// create new redirectListener and start listen for ilter applying once on window load
let redirectFilterInitialized = false;

window.addEventListener("load",
		function(e) {
			if (redirectFilterInitialized) {
				return;
			}
			let redirectlistener1 = new redirectListener();
			redirectlistener1.start();
			redirectFilterInitialized = true;
		},
		false);
})();
