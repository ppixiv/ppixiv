# A minimal ADO implementation, which is just enough to interface with Windows Search.
# This is a minimal rewrite of:
#
# https://github.com/mhammond/pywin32/blob/main/adodbapi/adodbapi.py
#
# to avoid licensing problems.

import datetime, pythoncom, sys
from win32com.client import Dispatch

class Constants:
    """
    See:
    
    http://msdn.microsoft.com/en-us/library/ms678353(VS.85).aspx
    http://msdn2.microsoft.com/en-us/library/ms675318.aspx
    """
    # CommandTypeEnum
    adCmdText = 1

    # ObjectStateEnum
    adStateClosed        = 0x00

    # DataTypeEnum
    adSmallInt           = 0x02
    adInteger            = 0x03
    adSingle             = 0x04
    adDouble             = 0x05
    adBoolean            = 0x0B
    adDecimal            = 0x0E
    adUnsignedSmallInt   = 0x12
    adUnsignedInt        = 0x13
    adBigInt             = 0x14
    adUnsignedBigInt     = 0x15
    adBinary             = 0x80
    adVarBinary          = 0xCC
    adLongVarBinary      = 0xCD

class WindowsSearchError(Exception): pass

from contextlib import contextmanager

def search(timeout, query):
    try:
        pythoncom.CoInitialize()

        # Open the database connection.
        connection = Dispatch('ADODB.Connection')
        connection.ConnectionString = 'Provider=Search.CollatorDSO; Extended Properties="Application=Windows"'
        connection.ConnectionTimeout = timeout
        connection.Open()
    except Exception as e:
        raise WindowsSearchError('Error connecting to Windows search')

    try:
        # Run the search command.
        try:
            command = Dispatch('ADODB.Command')
        except Exception as e:
            raise WindowsSearchError('Error creating ADODB.Command')

        command.ActiveConnection = connection
        command.CommandType = Constants.adCmdText
        command.CommandText = query
        command.CommandTimeout = timeout

        results, _ = command.Execute()
        if results is None or results.State == Constants.adStateClosed:
            return

        try:
            # Yield each row.
            while True:
                if results.State == Constants.adStateClosed or results.BOF or results.EOF:
                    return

                result = results.GetRows(1)

                # Convert the row to a dictionary, converting to basic Python types as we go.
                row = {}
                for idx in range(results.Fields.Count):
                    field = results.Fields(idx)
                    value = result[idx][0]
                    value = _convert_value(value, field.Type)
                    row[field.Name] = value

                yield row
        finally:
            if results.State != Constants.adStateClosed:
                results.Close()
    finally:
        connection.Close()

def _convert_value(value, value_type):
    if value is None:
        return None

    match value_type:
        case Constants.adInteger | Constants.adSmallInt | Constants.adUnsignedInt | Constants.adUnsignedSmallInt | \
            Constants.adBigInt | Constants.adUnsignedBigInt | Constants.adDecimal:
            return int(value)
        case Constants.adBoolean:
            return bool(value)
        case Constants.adSingle | Constants.adDouble:
            return float(value)
        case Constants.adBinary | Constants.adLongVarBinary | Constants.adVarBinary:
            return bytes(value)
        case _:
            return value
           
def escape_sql(s):
    """
    Escape a string for injection into an SQL query.

    Search.CollatorDSO doesn't seem to support parameters at all, so we have to do
    this the ugly way.  There's no real risk of SQL injection, since this is a
    query-only database anyway.
    """
    result = ''
    for c in s:
        if c == '\'':
            result += "'"
        result += c
    return result

