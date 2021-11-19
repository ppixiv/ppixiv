class Error(Exception):
    def __init__(self, code, reason):
        self.code = code
        self.reason = reason
    def data(self):
        return {
            'success': False,
            'code': self.code,
            'reason': self.reason,
        }
