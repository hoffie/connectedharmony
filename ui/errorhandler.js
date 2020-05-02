window.sendErrorEventID = 0;
window.sendErrorEvent = function(e) {
	try {
		window.sendErrorEventID++;
		e.ClientErrorID = window.sendErrorEventID;
		if (e.ErrorObject && typeof e.ErrorObject !== "string") {
			e.ErrorObject = JSON.stringify(e.ErrorObject);
		}
		fetch('/api/errors', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(e)
		})
		.then(async (d) => {
			if (d && d.status == 201 && d.ok) {
				return;
			}
			console.log("failed to send error event to server, unexpected fetch status", d);
		})
		.catch((e) => {
			console.log("failed to send error event to server, fetch returned", e);
		});
	} catch(e) {
		console.log("failed to send error event to server", e);
	}
}

window.onerror = function (message, url, line, column, error) {
	var e = {
		Source: 'window.onerror',
		Message: message,
		URI: url,
		Line: line,
		Column: column,
		ErrorObject: error,
	};
	sendErrorEvent(e);

	// 'false' lets normal error handling continue:
  return false;
};
