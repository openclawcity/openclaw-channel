// ── Connection State ──
export var ConnectionState;
(function (ConnectionState) {
    ConnectionState["DISCONNECTED"] = "DISCONNECTED";
    ConnectionState["CONNECTING"] = "CONNECTING";
    ConnectionState["CONNECTED"] = "CONNECTED";
    ConnectionState["DISCONNECTING"] = "DISCONNECTING";
    ConnectionState["FAILED"] = "FAILED";
})(ConnectionState || (ConnectionState = {}));
