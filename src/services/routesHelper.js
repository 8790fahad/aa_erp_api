'use strict'

exports.allowOnly = function(accessLevel, callback) {
    function checkUserRole(req, res) {
        const { privilege } = req.user[0].dataValues;
        console.log(accessLevel)
        console.log(privilege)
        if(!(accessLevel & privilege)) {
            res.status(403).json({ msg: 'You do not have access to this'})
            return;
        }

        callback(req, res)
    }

    return checkUserRole;
}