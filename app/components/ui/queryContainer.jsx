import React from 'react'
import PropTypes from 'prop-types'

const QueryContainer = ({ children, ...rest }) => {
    
    return (
        <s-query-container {...rest}>
            {children}
        </s-query-container>
    )
}

QueryContainer.propTypes = {
    children: PropTypes.node.isRequired,
}

export default QueryContainer