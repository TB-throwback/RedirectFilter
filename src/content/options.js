/*
 ***** BEGIN LICENSE BLOCK *****
 *
 * ***** END LICENSE BLOCK *****
 */

const Cc = Components.classes;
const Ci = Components.interfaces;

function createMenuItem(aLabel,aValue,aId) {
	const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
	let item = document.createElementNS(XUL_NS, "menuitem"); // create a new XUL menuitem
	item.setAttribute("label", aLabel);
	item.setAttribute("value", aValue);
	item.setAttribute("id", aId);
	return item;
}

function onLoad() {
	// insert accounts to list
	let am = Components.classes["@mozilla.org/messenger/account-manager;1"].getService(Components.interfaces.nsIMsgAccountManager);
	let menupopupAccounts = document.getElementById("menupopupAccounts");
	for (let i = 0; i < am.accounts.Count(); i++) { // go through all accounts and look for one that have root folder similar to first redirecting message root folder
		let amacc = am.accounts.QueryElementAt(i, Ci.nsIMsgAccount);
		try {
			let newItem = createMenuItem(amacc.defaultIdentity.identityName,amacc.key,amacc.key);
			menupopupAccounts.appendChild(newItem);
		} catch (e) {}
	}
	let prefs = Cc["@mozilla.org/preferences-service;1"].
			   getService(Ci.nsIPrefService);
	prefs = prefs.getBranch("extensions.redirectfilter.");
	try {
		document.getElementById("mlistAccount").selectedItem = document.getElementById(prefs.getCharPref("account"));
	} catch (e) {}
}
