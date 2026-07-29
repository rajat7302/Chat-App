const express = require('express');
const router = express.Router();
const User = require('../models/user');
const Report = require('../models/report');
const { restrictToAdmin } = require('../middlewares/authentication');

router.get('/dashboard', restrictToAdmin, async (req, res) => {
    try {
        const users = await User.find({});
        const reports = await Report.find({ status: 'PENDING' })
            .populate('reporter', 'username email')
            .populate('reportedUser', 'username email isBanned');

        return res.render('adminDashboard', { users, reports });
    } catch (err) {
        console.error("[ADMIN DASHBOARD ERROR]", err);
        return res.status(500).send("Server Error");
    }
});

router.post('/report/resolve-and-ban/:reportId', restrictToAdmin, async (req, res) => {
    try {
        const { reportId } = req.params;
        const { action } = req.body; // 'ban' or 'dismiss'

        const report = await Report.findById(reportId);
        if (!report) return res.status(404).send("Report not found");

        if (action === 'ban' && report.reportedUser) {
            await User.findByIdAndUpdate(report.reportedUser, {
                isBanned: true,
                banReason: `Banned via user report: ${report.reason}`
            });
        }

        report.status = 'RESOLVED';
        await report.save();

        return res.redirect('/admin/dashboard');
    } catch (err) {
        console.error("[RESOLVE REPORT ERROR]", err);
        return res.status(500).send("Server Error");
    }
});

router.post('/user/toggle-ban/:userId', restrictToAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        
        const targetUser = await User.findById(userId);
        if (!targetUser) return res.status(404).send("User not found");

        // Prevent modifying admin accounts
        if (targetUser.role === 'admin') {
            return res.status(403).send("Cannot ban admin accounts.");
        }

        targetUser.isBanned = !targetUser.isBanned;
        targetUser.banReason = targetUser.isBanned ? 'Direct administrative action' : '';
        await targetUser.save();

        return res.redirect('/admin/dashboard');
    } catch (err) {
        console.error("[TOGGLE BAN ERROR]", err);
        return res.status(500).send("Server Error");
    }
});

module.exports = router;